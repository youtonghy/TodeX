import { memo, useEffect } from 'react';

import { ModelPickerModal, PromptModal, SkillPickerModal, ThreadInfoModal } from '../components/modals';
import { notify } from '../components/ui';
import {
  modelCommandInitialValue,
  parseModelCommandArgs,
  type SelectedSkillAttachment,
  type SkillListItem,
  type ThreadCommandPromptState,
} from '../lib/appCore';
import { normalizeReasoningEffort, type CodexModelCatalogItem, type ConnectionSettings } from '../lib/todex';
import { useAppRuntime, useExternalStoreValue, useKeyedStoreValue, useRouteSnapshot } from './appRuntime';

const EMPTY_SKILLS = Object.freeze([]) as unknown as SelectedSkillAttachment[];
const EMPTY_SKILL_ITEMS = Object.freeze([]) as unknown as SkillListItem[];

export const APP_OVERLAY_CONTEXT_SNAPSHOT = 'overlay:context';
export const APP_OVERLAY_ACTIONS = 'actions:overlays';

export type AppOverlayContextSnapshot = {
  settings: ConnectionSettings;
  modelCatalog: CodexModelCatalogItem[];
  modelCatalogStatus: 'idle' | 'loading' | 'ready' | 'error';
  modelCatalogError: string;
  selectedSkills: Readonly<Record<string, SelectedSkillAttachment[]>>;
};

export type AppOverlayActions = {
  requestModelCatalog: () => boolean;
  requestSkillList: (conversationId: string, forceReload?: boolean) => Promise<boolean>;
  toggleSelectedSkill: (conversationId: string, skill: SkillListItem) => void;
  applyDefaultModelSelection: (model: string, reasoningEffort: string | null) => void;
  applyWorkspaceModelSelection: (conversationId: string, model: string, reasoningEffort: string | null) => void;
  applyModelCommand: (conversationId: string, args: string[], promptWhenEmpty?: boolean) => void;
  submitThreadCommandPrompt: (prompt: ThreadCommandPromptState, value: string) => boolean;
};

export const AppOverlayHost = memo(function AppOverlayHost() {
  const runtime = useAppRuntime();
  const overlays = useExternalStoreValue(runtime.overlays.snapshot);
  const context = useRouteSnapshot<AppOverlayContextSnapshot>(APP_OVERLAY_CONTEXT_SNAPSHOT);
  const actions = runtime.actions.get<AppOverlayActions>(APP_OVERLAY_ACTIONS);

  const modelPickerConversationId = overlays.modelPicker?.value.conversationId ?? '';
  const modelPickerConversation = useKeyedStoreValue(runtime.conversations, modelPickerConversationId);
  const modelPickerWorkspace = useKeyedStoreValue(runtime.workspaces, modelPickerConversation?.workspaceId ?? '');
  const modelCommandConversationId = overlays.modelCommand?.value.conversationId ?? '';
  const modelCommandConversation = useKeyedStoreValue(runtime.conversations, modelCommandConversationId);
  const skillConversationId = overlays.skillPicker?.value.conversationId ?? '';
  const skillConversation = useKeyedStoreValue(runtime.conversations, skillConversationId);
  const skillWorkspace = useKeyedStoreValue(runtime.workspaces, skillConversation?.workspaceId ?? '');
  const threadConversationId = overlays.threadCommand?.value.conversationId ?? '';
  const threadConversation = useKeyedStoreValue(runtime.conversations, threadConversationId);

  useEffect(() => {
    const invalidModelPicker = overlays.modelPicker?.value.target === 'workspace'
      && overlays.modelPicker.value.conversationId
      && !modelPickerConversation;
    const invalidModelCommand = overlays.modelCommand?.value.target !== 'settings'
      && overlays.modelCommand?.value.conversationId
      && !modelCommandConversation;
    const invalidSkillPicker = overlays.skillPicker && !skillConversation;
    const invalidThreadCommand = overlays.threadCommand && !threadConversation;
    if (!invalidModelPicker && !invalidModelCommand && !invalidSkillPicker && !invalidThreadCommand) return;

    if (invalidModelPicker) runtime.overlays.close('modelPicker', overlays.modelPicker?.id);
    if (invalidModelCommand) runtime.overlays.close('modelCommand', overlays.modelCommand?.id);
    if (invalidSkillPicker) runtime.overlays.close('skillPicker', overlays.skillPicker?.id);
    if (invalidThreadCommand) runtime.overlays.close('threadCommand', overlays.threadCommand?.id);
    notify.warning('目标已失效', '对应对话已不存在，请重新选择。');
  }, [modelCommandConversation, modelPickerConversation, overlays, runtime, skillConversation, threadConversation]);

  if (!context) return null;

  const modelCommand = overlays.modelCommand;
  const modelPicker = overlays.modelPicker;
  const threadInfo = overlays.threadInfo;
  const threadCommand = overlays.threadCommand;
  const skillPicker = overlays.skillPicker;

  return (
    <>
      <PromptModal
        visible={Boolean(modelCommand)}
        title="切换模型"
        initialValue={modelCommand?.value.initialValue ?? ''}
        placeholder="gpt-5.5 high"
        onCancel={() => runtime.overlays.close('modelCommand', modelCommand?.id)}
        onSubmit={(value) => {
          if (!modelCommand) return;
          if (modelCommand.value.target === 'settings') {
            const { model, reasoningEffort, invalidReasoningEffort } = parseModelCommandArgs(value.trim().split(/\s+/));
            if (invalidReasoningEffort) {
              notify.warning('无效思考强度', '支持 none、minimal、low、medium、high、xhigh，也支持 max 作为 xhigh 的别名。');
              return;
            }
            actions.applyDefaultModelSelection(
              model || context.settings.defaultModel,
              reasoningEffort ?? context.settings.defaultReasoningEffort ?? null,
            );
          } else {
            actions.applyModelCommand(modelCommand.value.conversationId, value.trim().split(/\s+/), false);
          }
          runtime.overlays.close('modelCommand', modelCommand.id);
        }}
      />
      <PromptModal
        visible={Boolean(threadCommand)}
        title={threadCommand?.value.title ?? 'Thread'}
        initialValue={threadCommand?.value.initialValue ?? ''}
        placeholder={threadCommand?.value.placeholder ?? ''}
        warning={threadCommand?.value.warning}
        multiline={threadCommand?.value.multiline}
        submitTitle="发送"
        onCancel={() => runtime.overlays.close('threadCommand', threadCommand?.id)}
        onSubmit={(value) => {
          if (threadCommand && actions.submitThreadCommandPrompt(threadCommand.value, value)) {
            runtime.overlays.close('threadCommand', threadCommand.id);
          }
        }}
      />
      <ThreadInfoModal
        visible={Boolean(threadInfo)}
        title={threadInfo?.value.title ?? ''}
        detail={threadInfo?.value.detail ?? ''}
        raw={threadInfo?.value.raw}
        onClose={() => runtime.overlays.close('threadInfo', threadInfo?.id)}
      />
      <SkillPickerModal
        visible={Boolean(skillPicker)}
        workspace={skillWorkspace}
        conversationId={skillConversationId}
        status={skillPicker?.value.status ?? 'idle'}
        error={skillPicker?.value.error ?? ''}
        skills={skillPicker?.value.items ?? EMPTY_SKILL_ITEMS}
        selectedSkills={context.selectedSkills[skillConversationId] ?? EMPTY_SKILLS}
        onRefresh={() => void actions.requestSkillList(skillConversationId, true)}
        onToggleSkill={(skill) => actions.toggleSelectedSkill(skillConversationId, skill)}
        onClose={() => runtime.overlays.close('skillPicker', skillPicker?.id)}
      />
      <ModelPickerModal
        visible={Boolean(modelPicker)}
        title={modelPicker?.value.target === 'settings' ? '默认模型' : '当前对话模型'}
        catalog={context.modelCatalog}
        selectedModel={modelPicker?.value.target === 'settings'
          ? context.settings.defaultModel
          : modelPickerWorkspace?.model || context.settings.defaultModel}
        selectedReasoningEffort={modelPicker?.value.target === 'settings'
          ? normalizeReasoningEffort(context.settings.defaultReasoningEffort)
          : normalizeReasoningEffort(modelPickerWorkspace?.reasoningEffort ?? context.settings.defaultReasoningEffort)}
        loading={context.modelCatalogStatus === 'loading'}
        error={context.modelCatalogError}
        onRefresh={actions.requestModelCatalog}
        onCancel={() => runtime.overlays.close('modelPicker', modelPicker?.id)}
        onSubmit={(model, reasoningEffort) => {
          if (!modelPicker) return;
          runtime.overlays.close('modelPicker', modelPicker.id);
          if (modelPicker.value.target === 'settings') {
            actions.applyDefaultModelSelection(model, reasoningEffort);
          } else if (modelPicker.value.conversationId) {
            actions.applyWorkspaceModelSelection(modelPicker.value.conversationId, model, reasoningEffort);
          }
        }}
        onManual={() => {
          if (!modelPicker) return;
          if (modelPicker.value.target === 'settings') {
            runtime.overlays.replaceModelPickerWithCommand(modelPicker.id, {
              conversationId: modelPickerConversationId,
              initialValue: [context.settings.defaultModel, normalizeReasoningEffort(context.settings.defaultReasoningEffort)].filter(Boolean).join(' '),
              target: 'settings',
            });
          } else if (modelPickerWorkspace && modelPicker.value.conversationId) {
            runtime.overlays.replaceModelPickerWithCommand(modelPicker.id, {
              conversationId: modelPicker.value.conversationId,
              initialValue: modelCommandInitialValue(modelPickerWorkspace, context.settings),
            });
          }
        }}
      />
    </>
  );
});
