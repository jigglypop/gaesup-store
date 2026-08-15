// Command pipeline (spec §25-26): optimistic transition -> execute -> commit,
// or rollback of the optimistic writes when execution fails. Built on the
// graph's write journal, so a rollback restores exact previous values and
// notifies subscribers of the reversion.

import { batch, recordWrites, type WriteJournal } from './graph';

export interface CommandOptions<TInput, TResult> {
  optimistic?: (input: TInput) => void;
  execute: (input: TInput) => TResult | Promise<TResult>;
  commit?: (result: TResult, input: TInput) => void;
}

export type GraphCommand<TInput, TResult> = (input: TInput) => Promise<TResult>;

export function command<TInput = void, TResult = void>(
  options: CommandOptions<TInput, TResult>
): GraphCommand<TInput, TResult> {
  return async (input: TInput): Promise<TResult> => {
    let journal: WriteJournal | null = null;
    if (options.optimistic) {
      journal = recordWrites(() => options.optimistic!(input));
    }
    try {
      const result = await options.execute(input);
      if (options.commit) {
        batch(() => options.commit!(result, input));
      }
      return result;
    } catch (error) {
      journal?.revert();
      throw error;
    }
  };
}
