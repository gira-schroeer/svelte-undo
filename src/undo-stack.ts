import type { ReadableUndoAction, UndoAction } from './action/action';
import { get, writable } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { InitAction } from './action/action-init';
import {
  loadActionsSnapshot,
  createSnapshotFromActions,
  type UndoActionSnapshot,
} from './snapshot';

type UndoStackData<TMsg> = {
  actions: UndoAction<TMsg>[];
  selectedAction: UndoAction<TMsg>;
  canRedo: boolean;
  canUndo: boolean;
  index: number;
  ticker: number;
};

type ReadableUndoStackData<TMsg> = {
  readonly actions: ReadonlyArray<ReadableUndoAction<TMsg>>;
  readonly selectedAction: ReadableUndoAction<TMsg>;
  readonly canRedo: boolean;
  readonly canUndo: boolean;
  readonly index: number;
  readonly ticker: number;
};

function newUndoStackData<TMsg>(initActionMsg: TMsg): UndoStackData<TMsg> {
  const selectedAction = new InitAction(initActionMsg);
  return {
    actions: [selectedAction],
    selectedAction,
    canRedo: false,
    canUndo: false,
    index: 0,
    ticker: 0,
  };
}

export type UndoStackSnapshot<TMsg> = {
  actions: UndoActionSnapshot<TMsg>[];
  index: number;
};

export interface ActionStack<TMsg> {
  push: (action: UndoAction<TMsg>) => void;
}

export interface UndoStack<TMsg>
  extends Readable<ReadableUndoStackData<TMsg>>,
    ActionStack<TMsg> {
  undo: () => void;
  redo: () => void;
  goto: (index: number) => void;
  clear: () => void;
  createSnapshot: (stores: Record<string, unknown>) => UndoStackSnapshot<TMsg>;
  loadSnapshot: (
    undoStackSnapshot: UndoStackSnapshot<TMsg>,
    stores: Record<string, unknown>,
  ) => void;
}

export function undoStack<TMsg>(initActionMsg: TMsg): UndoStack<TMsg> {
  const store = writable(newUndoStackData(initActionMsg));

  function push(action: UndoAction<TMsg>) {
    store.update((undoStack) => {
      undoStack.ticker++;
      action.seqNbr = undoStack.ticker;
      const deleteCount = undoStack.actions.length - undoStack.index - 1;
      undoStack.actions.splice(undoStack.index + 1, deleteCount, action);
      undoStack.index = undoStack.actions.length - 1;
      undoStack.canUndo = undoStack.actions.length > 0;
      undoStack.canRedo = false;
      undoStack.selectedAction = action;
      return undoStack;
    });
  }

  function undo() {
    store.update((undoStack) => {
      if (undoStack.index <= 0) {
        return undoStack;
      }

      undoStack.actions[undoStack.index].revert();
      undoStack.index--;
      undoStack.canUndo = undoStack.index > 0;
      undoStack.canRedo = true;
      undoStack.selectedAction = undoStack.actions[undoStack.index];
      undoStack.ticker++;
      return undoStack;
    });
  }

  function redo() {
    store.update((undoStack) => {
      if (undoStack.index >= undoStack.actions.length - 1) {
        return undoStack;
      }

      undoStack.index++;
      undoStack.actions[undoStack.index].apply();
      undoStack.canUndo = true;
      undoStack.canRedo = undoStack.index < undoStack.actions.length - 1;
      undoStack.selectedAction = undoStack.actions[undoStack.index];
      undoStack.ticker++;
      return undoStack;
    });
  }

  function goto(seqNbr: number) {
    store.update((undoStack) => {
      const targetIndex = undoStack.actions.findIndex(
        (a) => a.seqNbr === seqNbr,
      );
      if (targetIndex < 0) {
        return undoStack;
      }

      // -1 = undo (revert-action), 1 = redo (apply-action)
      const step = Math.sign(targetIndex - undoStack.index);

      for (; undoStack.index != targetIndex; undoStack.index += step) {
        if (step < 0) {
          undoStack.actions[undoStack.index].revert();
        } else {
          undoStack.actions[undoStack.index + 1].apply();
        }
      }

      undoStack.canUndo = undoStack.index > 0;
      undoStack.canRedo = undoStack.index < undoStack.actions.length - 1;
      undoStack.selectedAction = undoStack.actions[undoStack.index];
      undoStack.ticker++;
      return undoStack;
    });
  }

  function clear() {
    store.set(newUndoStackData(initActionMsg));
  }

  function createSnapshot(
    stores: Record<string, unknown>,
  ): UndoStackSnapshot<TMsg> {
    const undoStack = get(store);

    return {
      actions: createSnapshotFromActions(undoStack.actions, stores),
      index: undoStack.index,
    };
  }

  function loadSnapshot(
    undoStackSnapshot: UndoStackSnapshot<TMsg>,
    stores: Record<string, unknown>,
  ) {
    const actions = loadActionsSnapshot(undoStackSnapshot.actions, stores);
    let ticker = 0;
    for (const action of actions) {
      action.seqNbr = ticker++;
    }

    store.set({
      actions,
      selectedAction: actions[undoStackSnapshot.index],
      canRedo: undoStackSnapshot.index < undoStackSnapshot.actions.length - 1,
      canUndo: undoStackSnapshot.index > 0,
      ticker,
      index: undoStackSnapshot.index,
    });
  }

  return {
    subscribe: store.subscribe,
    push,
    undo,
    redo,
    goto,
    clear,
    createSnapshot,
    loadSnapshot,
  };
}
