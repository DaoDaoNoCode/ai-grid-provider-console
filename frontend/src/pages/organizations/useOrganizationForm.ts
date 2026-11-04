import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ServiceError } from '../../api/ConsoleService';
import type { OrganizationsService } from '../../api/organizations';
import type { Organization, OrganizationInput } from '../../api/types';
import {
  fieldErrorsOf,
  identityProviderSchema,
  isBlankIdentityProvider,
  organizationInputSchema,
  tenantDetailsSchema,
} from '../../validation';
import { ORGANIZATION_CHANGED, currentServerErrors, emptyOrganizationInput, errorsUnder } from './serverErrors';

const saveErrorMessage = (err: unknown, editing: boolean) => {
  if (err instanceof ServiceError && err.isNotImplemented) {
    return 'Saving organizations is not available on this AI Grid backend.';
  }
  if (editing && err instanceof ServiceError && err.status === 409) {
    return ORGANIZATION_CHANGED;
  }
  return err instanceof Error ? err.message : 'Unable to save the organization.';
};

/** The form always holds an identity provider; a blank one is left out on save. */
type FormValues = Required<OrganizationInput>;

const initialValues = (initial?: Organization): FormValues =>
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
export const useOrganizationForm = (service: OrganizationsService, initial?: Organization) => {
  const navigate = useNavigate();
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
      if (initial) {
        await service.updateOrganization(initial.id, input.data, initial.resourceVersion);
      } else {
        await service.createOrganization(input.data);
      }
      // A created organization replaces its create form in history, so Back doesn't land on it, empty.
      navigate(initial ? `/organizations/${encodeURIComponent(initial.id)}` : '/organizations', {
        replace: !initial,
        state: {
          notice: initial ? 'Organization updated' : 'Organization created',
        },
      });
    } catch (err) {
      setError(saveErrorMessage(err, !!initial));
      if (err instanceof ServiceError && err.fieldErrors) {
        setServer({ errors: err.fieldErrors, sent: values });
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
