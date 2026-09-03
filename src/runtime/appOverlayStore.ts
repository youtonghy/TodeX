import type {
  ModelCommandPromptState,
  ModelPickerPromptState,
  SkillListItem,
  SkillListStatus,
  ThreadCommandPromptState,
  ThreadInfoModalState,
} from '../lib/appCore';
import { ExternalStore, RuntimeTransaction } from './externalStore';

export type OverlayEntry<Value> = Readonly<{
  id: string;
  value: Value;
}>;

export type SkillPickerOverlayState = {
  conversationId: string;
  requestId: string;
  status: SkillListStatus;
  error: string;
  items: SkillListItem[];
};

export type AppOverlaySnapshot = Readonly<{
  modelCommand: OverlayEntry<ModelCommandPromptState> | null;
  modelPicker: OverlayEntry<ModelPickerPromptState> | null;
  threadInfo: OverlayEntry<ThreadInfoModalState> | null;
  threadCommand: OverlayEntry<ThreadCommandPromptState> | null;
  skillPicker: OverlayEntry<SkillPickerOverlayState> | null;
}>;

const EMPTY_OVERLAYS: AppOverlaySnapshot = Object.freeze({
  modelCommand: null,
  modelPicker: null,
  threadInfo: null,
  threadCommand: null,
  skillPicker: null,
});

type OverlaySlot = keyof AppOverlaySnapshot;

export class AppOverlayStore {
  readonly snapshot: ExternalStore<AppOverlaySnapshot>;
  private nextId = 0;

  constructor(transaction = new RuntimeTransaction()) {
    this.snapshot = new ExternalStore<AppOverlaySnapshot>(EMPTY_OVERLAYS, transaction);
  }

  openModelCommand(value: ModelCommandPromptState): string {
    return this.open('modelCommand', value);
  }

  openModelPicker(value: ModelPickerPromptState): string {
    return this.open('modelPicker', value);
  }

  openThreadInfo(value: ThreadInfoModalState): string {
    return this.open('threadInfo', value);
  }

  openThreadCommand(value: ThreadCommandPromptState): string {
    return this.open('threadCommand', value);
  }

  openSkillPicker(value: SkillPickerOverlayState): string {
    return this.open('skillPicker', value);
  }

  close(slot: OverlaySlot, expectedId?: string): void {
    this.snapshot.update((current) => {
      const entry = current[slot];
      if (!entry || (expectedId && entry.id !== expectedId)) return current;
      return { ...current, [slot]: null };
    });
  }

  replaceModelPickerWithCommand(expectedId: string, value: ModelCommandPromptState): void {
    this.snapshot.update((current) => {
      if (current.modelPicker?.id !== expectedId) return current;
      return {
        ...current,
        modelPicker: null,
        modelCommand: this.entry('modelCommand', value),
      };
    });
  }

  updateSkillRequest(
    requestId: string,
    patch: Partial<Pick<SkillPickerOverlayState, 'status' | 'error' | 'items'>>,
  ): void {
    this.snapshot.update((current) => {
      const entry = current.skillPicker;
      if (!entry || entry.value.requestId !== requestId) return current;
      const next = { ...entry.value, ...patch };
      if (
        next.status === entry.value.status
        && next.error === entry.value.error
        && next.items === entry.value.items
      ) return current;
      return { ...current, skillPicker: { ...entry, value: next } };
    });
  }

  private open<Slot extends OverlaySlot>(slot: Slot, value: NonNullable<AppOverlaySnapshot[Slot]>['value']): string {
    const entry = this.entry(slot, value);
    this.snapshot.update((current) => ({ ...current, [slot]: entry }));
    return entry.id;
  }

  private entry<Value>(slot: OverlaySlot, value: Value): OverlayEntry<Value> {
    this.nextId += 1;
    return { id: `${slot}:${this.nextId}`, value };
  }
}
