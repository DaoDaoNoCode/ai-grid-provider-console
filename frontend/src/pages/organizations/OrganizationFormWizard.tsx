// Ported from krisv/ai-grid-cloud-provider-poc src/app/pages/tenants/TenantFormWizard.tsx at 62319b8.
// Combined adaptation of OSAC TenantCreatePage and IdentityProviderCreateWizard.
// Source commit: 8cb0a227e45cc9b17421b6e79ce493ed370ebd5d. Break-glass flow is omitted.
import { Form, Wizard, WizardStep, useWizardContext } from '@patternfly/react-core';
import type { OrganizationsService } from '../../api/organizations';
import type { Organization, OrganizationInput } from '../../api/types';
import { ConsoleWizardFooter } from '../../components/ConsoleWizardFooter';
import { useConfirmDiscard } from '../../hooks/useConfirmDiscard';
import { IdentityProviderFields } from './IdentityProviderFields';
import type { OrganizationSection } from './OrganizationConfigurationDetails';
import { OrganizationConfigurationDetails } from './OrganizationConfigurationDetails';
import { OrganizationDetailsFields } from './OrganizationDetailsFields';
import { useOrganizationForm } from './useOrganizationForm';

type Props = {
  service: OrganizationsService;
  /** The organization to edit; without it the wizard creates one. */
  organization?: Organization;
};

const stepOf: Record<OrganizationSection, string> = { details: 'tenant-details', identityProvider: 'tenant-idp' };

/** The Review step; its Edit links go back to the step that edits each section. */
const ReviewStep: React.FC<{ organization: OrganizationInput }> = ({ organization }) => {
  const { goToStepById } = useWizardContext();
  return (
    <OrganizationConfigurationDetails
      organization={organization}
      variant="review"
      onEditSection={(section) => goToStepById(stepOf[section])}
    />
  );
};

/**
 * Creates an organization in three steps: its details, its identity provider, then a review. With
 * `organization` it edits that one through the same steps: every step can be opened from the start,
 * the name is read-only, and Save changes on the Review step stays disabled until something changed.
 */
export const OrganizationFormWizard: React.FC<Props> = ({ service, organization }) => {
  const editing = !!organization;
  const form = useOrganizationForm(service, organization);
  const { values, setValues, saving } = form;
  const [requestLeave, discardModal] = useConfirmDiscard(form.isDirty && !saving, form.leave);

  return (
    <>
      <Wizard
        navAriaLabel="Organization onboarding steps"
        onClose={requestLeave}
        footer={
          <ConsoleWizardFooter
            submitStepId="tenant-review"
            submitLabel={editing ? 'Save changes' : 'Create organization'}
            errorTitle="Unable to save organization"
            isStepValid={(step) =>
              form.detailsValid &&
              (step === 'tenant-details' || form.idpValid) &&
              (step !== 'tenant-review' || !editing || form.isDirty)
            }
            saving={saving}
            error={form.error}
            onSubmit={form.save}
            onCancel={requestLeave}
          />
        }
      >
        <WizardStep name="Organization details" id="tenant-details">
          <Form maxWidth="750px">
            <OrganizationDetailsFields
              value={{ name: values.name, domains: values.domains }}
              onChange={(details) => setValues({ ...values, ...details })}
              errors={form.detailErrors}
              serverErrors={form.detailServerErrors}
              isNameEditable={!editing}
              isDisabled={saving}
            />
          </Form>
        </WizardStep>
        <WizardStep name="Identity provider" id="tenant-idp" isDisabled={!form.detailsValid || saving}>
          <Form maxWidth="750px">
            <IdentityProviderFields
              value={values.identityProvider}
              serverErrors={form.idpServerErrors}
              onChange={(identityProvider) => setValues({ ...values, identityProvider })}
              isDisabled={saving}
            />
          </Form>
        </WizardStep>
        <WizardStep name="Review" id="tenant-review" isDisabled={!form.detailsValid || !form.idpValid || saving}>
          <ReviewStep organization={values} />
        </WizardStep>
      </Wizard>
      {discardModal}
    </>
  );
};
