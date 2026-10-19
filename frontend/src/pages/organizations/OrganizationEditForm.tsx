import { ActionGroup, Alert, Button, Form, FormSection, Title } from '@patternfly/react-core';
import type { OrganizationsService } from '../../api/organizations';
import type { Organization } from '../../api/types';
import { useConfirmDiscard } from '../../hooks/useConfirmDiscard';
import { IdentityProviderFields } from './IdentityProviderFields';
import { OrganizationDetailsFields } from './OrganizationDetailsFields';
import { useOrganizationForm } from './useOrganizationForm';

type Props = { service: OrganizationsService; organization: Organization };

/** The form's top-level sections read above the field groups (Domains, Connection) inside them. */
const SectionTitle: React.FC<{ children: string }> = ({ children }) => (
  <Title headingLevel="h2" size="xl">
    {children}
  </Title>
);

/**
 * Edits an organization on one page: a change to one field doesn't mean stepping through the
 * create wizard. The name is fixed once the organization exists.
 */
export const OrganizationEditForm: React.FC<Props> = ({ service, organization }) => {
  const form = useOrganizationForm(service, organization);
  const { values, setValues, saving } = form;
  const [requestLeave, discardModal] = useConfirmDiscard(form.isDirty && !saving, form.leave);

  return (
    <>
      <Form
        maxWidth="750px"
        onSubmit={(event) => {
          event.preventDefault();
          void form.save();
        }}
      >
        <FormSection title={<SectionTitle>Organization details</SectionTitle>}>
          <OrganizationDetailsFields
            value={{ name: values.name, domains: values.domains }}
            onChange={(details) => setValues({ ...values, ...details })}
            errors={form.detailErrors}
            serverErrors={form.detailServerErrors}
            isNameEditable={false}
            isDisabled={saving}
          />
        </FormSection>
        <FormSection title={<SectionTitle>Identity provider</SectionTitle>}>
          <IdentityProviderFields
            value={values.identityProvider}
            serverErrors={form.idpServerErrors}
            onChange={(identityProvider) => setValues({ ...values, identityProvider })}
          />
        </FormSection>
        {form.error && (
          <Alert isInline variant="danger" title="Unable to save organization">
            {form.error}
          </Alert>
        )}
        <ActionGroup>
          <Button
            type="submit"
            isLoading={saving}
            isDisabled={saving || !form.isDirty || !form.detailsValid || !form.idpValid}
          >
            Save changes
          </Button>
          <Button variant="link" isDisabled={saving} onClick={requestLeave}>
            Cancel
          </Button>
        </ActionGroup>
      </Form>
      {discardModal}
    </>
  );
};
