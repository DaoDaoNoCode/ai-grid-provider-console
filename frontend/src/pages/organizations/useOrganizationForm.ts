import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { describeError } from '../../api/connect/errors';
import { useNotifications } from '../../notifications/useNotifications';
import { organizationSavedText } from '../../notifications/writeText';
import {
  fieldErrorsOf,
  identityProviderSchema,
  isBlankIdentityProvider,
  organizationInputSchema,
  tenantDetailsSchema,
} from '../../validation';
import { formPathOf, type OrganizationInput, type OrganizationView } from './organizationView';
import { ORGANIZATION_CHANGED, currentServerErrors, emptyOrganizationInput, errorsUnder } from './serverErrors';
import { useOrganizationWrites } from './useOrganizations';

/**
 * What a refused save says: the backend's message, the console's words where describeError gives
 * them, and on an edit, for a stale version (Aborted), that someone else changed the organization.
 */
const saveErrorMessage = (err: unknown, editing: boolean) => {
  const { kind, message } = describeError(err);
  if (kind === 'notAvailable') {
    return 'Saving organizations is not available on this AI Grid backend.';
  }
  if (editing && kind === 'conflict') {
    return ORGANIZATION_CHANGED;
  }
  return message;
};

/** The backend's field violations, keyed by the form's paths. */
const serverFieldErrors = (err: unknown): Record<string, string> | undefined => {
  const { fieldErrors } = describeError(err);
  return fieldErrors && Object.fromEntries(Object.entries(fieldErrors).map(([field, msg]) => [formPathOf(field), msg]));
};

/** The form always holds an identity provider; a blank one is left out on save. */
type FormValues = Required<OrganizationInput>;

const initialValues = (initial?: OrganizationView): FormValues =>
  initial
    ? {
        name: initial.name,
        domains: initial.domains,
        // Without one, a blank provider: the edit never sends it, and the step shows a note instead.
        identityProvider: initial.identityProvider ?? emptyOrganizationInput().identityProvider,
      }
    : emptyOrganizationInput();

/**
 * The organization form's state, validation and save, shared by the create wizard and the edit
 * form: the values, the client-side errors by JSON path, the server's field errors that still
 * apply, and whether anything changed since the form opened.
 */
export const useOrganizationForm = (initial?: OrganizationView) => {
  const navigate = useNavigate();
  const writes = useOrganizationWrites();
  const { notify } = useNotifications();
  const [start] = useState(() => initialValues(initial));
  const [values, setValues] = useState<FormValues>(start);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  // The server's field errors and the form values they were returned for.
  const [server, setServer] = useState<{ errors: Record<string, string>; sent: OrganizationInput }>();

  const detailErrors = fieldErrorsOf(tenantDetailsSchema, { name: values.name, domains: values.domains });
  const detailsValid = Object.keys(detailErrors).length === 0;
  // The backend sets an identity provider only on create: an edit can't add, change or remove one.
  // The edit shows the stored one read-only and leaves it out of the save, which keeps it as it is.
  const idpLocked = !!initial;
  // Optional on create: a blank form is valid, and is left out on save.
  const idpBlank = !idpLocked && isBlankIdentityProvider(values.identityProvider);
  const idpValid = idpLocked || idpBlank || identityProviderSchema.safeParse(values.identityProvider).success;
  // What Review shows: on edit, the stored identity provider or none.
  const toSave: OrganizationInput = idpBlank
    ? { ...values, identityProvider: undefined }
    : idpLocked
      ? { ...values, identityProvider: initial?.identityProvider }
      : values;
  const serverErrors = server ? currentServerErrors(server.errors, server.sent, values) : {};

  const leave = () => navigate(initial ? `/organizations/${encodeURIComponent(initial.id)}` : '/organizations');

  const save = async () => {
    const input = organizationInputSchema.safeParse(idpLocked ? { ...toSave, identityProvider: undefined } : toSave);
    if (saving || !input.success) return;
    setSaving(true);
    setError(undefined);
    setServer(undefined);
    try {
      // An edit sends the domains only, at the version the form read.
      const saved = initial
        ? await writes.updateOrganization(initial, input.data.domains)
        : await writes.createOrganization(input.data);
      // The save is complete when the backend answers (a Keycloak write, or its rollback), so the
      // notification center says it once, by the name the backend answered with, in answer to the
      // user's click. A refusal stays on the form.
      notify({ variant: 'success', ...organizationSavedText(initial ? 'update' : 'create', saved), read: true });
      // A created organization replaces its create form in history, so Back doesn't land on it, empty.
      navigate(initial ? `/organizations/${encodeURIComponent(initial.id)}` : '/organizations', {
        replace: !initial,
      });
    } catch (err) {
      setError(saveErrorMessage(err, !!initial));
      const fieldErrors = serverFieldErrors(err);
      if (fieldErrors) {
        setServer({ errors: fieldErrors, sent: values });
      }
      setSaving(false);
    }
  };

  return {
    values,
    setValues,
    saving,
    error,
    detailErrors,
    detailsValid,
    idpValid,
    /** Editing: the identity provider can't change, so it's shown, never sent. */
    idpLocked,
    /** What a save sends, which the Review step shows: the values without a blank identity provider. */
    toSave,
    /** The server's errors for name and domains, keyed like detailErrors. */
    detailServerErrors: Object.fromEntries(
      Object.entries(serverErrors).filter(([path]) => !path.startsWith('identityProvider.')),
    ),
    /** The server's errors under identityProvider, keyed by the rest of the path. */
    idpServerErrors: errorsUnder(serverErrors, 'identityProvider'),
    isDirty: JSON.stringify(values) !== JSON.stringify(start),
    /** The last refused save's field errors, a new object each time, for moving to them. */
    serverErrorsSent: server,
    save,
    leave,
  };
};
