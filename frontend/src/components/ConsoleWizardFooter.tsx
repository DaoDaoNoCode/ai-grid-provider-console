import { Alert, WizardFooter, useWizardContext } from '@patternfly/react-core';

type Props = {
  /** The step whose primary button submits the wizard (its Review step). */
  submitStepId: string;
  /** The primary button's text on that step, for example "Create organization". */
  submitLabel: string;
  /** Whether a step's input is complete; Next (or submit) stays disabled on it until it is. */
  isStepValid: (stepId: string) => boolean;
  saving: boolean;
  /** The title of the alert that shows `error`, for example "Unable to save organization". */
  errorTitle: string;
  error?: string;
  onSubmit: () => Promise<void>;
  onCancel: () => void;
};

/**
 * The footer every console wizard uses, following PatternFly's wizard guidelines: Back is
 * disabled on the first step, Next becomes the submit action on the submit step, and a save
 * error shows above the buttons.
 */
export const ConsoleWizardFooter: React.FC<Props> = ({
  submitStepId,
  submitLabel,
  isStepValid,
  saving,
  errorTitle,
  error,
  onSubmit,
  onCancel,
}) => {
  const { activeStep, goToNextStep, goToPrevStep } = useWizardContext();
  const submitting = activeStep.id === submitStepId;
  return (
    <>
      {error && (
        <div className="pf-v6-u-px-lg">
          <Alert isInline variant="danger" title={errorTitle}>
            {error}
          </Alert>
        </div>
      )}
      <WizardFooter
        activeStep={activeStep}
        onNext={() => (submitting ? onSubmit() : goToNextStep())}
        onBack={goToPrevStep}
        onClose={onCancel}
        nextButtonText={submitting ? submitLabel : 'Next'}
        isNextDisabled={saving || !isStepValid(String(activeStep.id))}
        isBackDisabled={saving || activeStep.index === 1}
        cancelButtonProps={{ isDisabled: saving }}
        nextButtonProps={{ isLoading: saving }}
      />
    </>
  );
};
