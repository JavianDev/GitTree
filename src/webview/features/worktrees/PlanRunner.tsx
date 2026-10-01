import { useState } from 'react';

export interface StepOutcome {
  ok: boolean;
  /** Shown verbatim under the step: git's own output says more than a rewording. */
  output?: string;
}

export interface PlanStep {
  id: string;
  label: string;
  /** The exact git command, when the step is one. */
  command?: string;
  run: () => Promise<StepOutcome>;
}

type StepState = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

/**
 * Runs a plan's steps one at a time, stopping at the first failure.
 *
 * Every git step goes through `commands/run`, so it lands in the command log
 * like anything typed; the plan only sequences them and shows what happened.
 */
export function usePlanRunner(): {
  states: Record<string, StepState>;
  outputs: Record<string, string>;
  running: boolean;
  finished: boolean;
  failed: boolean;
  run: (steps: readonly PlanStep[]) => Promise<boolean>;
} {
  const [states, setStates] = useState<Record<string, StepState>>({});
  const [outputs, setOutputs] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = async (steps: readonly PlanStep[]): Promise<boolean> => {
    setRunning(true);
    setFinished(false);
    setFailed(false);
    setOutputs({});
    setStates(Object.fromEntries(steps.map((step) => [step.id, 'pending' as StepState])));

    let ok = true;
    for (const step of steps) {
      if (!ok) {
        setStates((current) => ({ ...current, [step.id]: 'skipped' }));
        continue;
      }
      setStates((current) => ({ ...current, [step.id]: 'running' }));
      let outcome: StepOutcome;
      try {
        outcome = await step.run();
      } catch (error) {
        outcome = { ok: false, output: error instanceof Error ? error.message : String(error) };
      }
      setStates((current) => ({ ...current, [step.id]: outcome.ok ? 'done' : 'failed' }));
      if (outcome.output) setOutputs((current) => ({ ...current, [step.id]: outcome.output! }));
      if (!outcome.ok) ok = false;
    }

    setRunning(false);
    setFinished(true);
    setFailed(!ok);
    return ok;
  };

  return { states, outputs, running, finished, failed, run };
}

const GLYPH: Record<StepState, string> = { pending: '○', running: '…', done: '✓', failed: '✗', skipped: '–' };

/** The numbered "What will run" list, with each step's state and output once it has run. */
export function PlanList({
  steps,
  states,
  outputs,
  first,
}: {
  steps: readonly Pick<PlanStep, 'id' | 'label' | 'command'>[];
  states: Record<string, StepState>;
  outputs: Record<string, string>;
  /** Replaces the first step's text — e.g. an editable command field. */
  first?: React.ReactNode;
}): React.JSX.Element {
  return (
    <ol className="gt-plan">
      {steps.map((step, index) => {
        const state = states[step.id];
        return (
          <li key={step.id} className="gt-plan-step" data-state={state}>
            <span className="gt-plan-index" aria-hidden="true">
              {state ? GLYPH[state] : index + 1}
            </span>
            <div className="gt-plan-body">
              {index === 0 && first ? first : step.command ? <code className="gt-plan-command">{step.command}</code> : <span>{step.label}</span>}
              {step.command && index !== 0 && <span className="gt-plan-note">{step.label}</span>}
              {outputs[step.id] && <pre className="gt-plan-output">{outputs[step.id]}</pre>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
