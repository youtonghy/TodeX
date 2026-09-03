import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Checkbox, Chip, SearchField } from 'heroui-native';

import type { WorkspaceRecord } from '../../lib/todex';
import { skillIdFromPath, type SelectedSkillAttachment, type SkillListItem, type SkillListStatus } from '../../lib/appCore';
import { AppSheet, EmptyStateView, InlineNotice, ListRow, ListSection, LoadingState, StyledIonicons } from '../ui';

export function SkillPickerModal({
  visible,
  workspace,
  conversationId,
  status,
  error,
  skills,
  selectedSkills,
  onRefresh,
  onToggleSkill,
  onClose,
}: {
  visible: boolean;
  workspace: WorkspaceRecord | null;
  conversationId: string;
  status: SkillListStatus;
  error: string;
  skills: SkillListItem[];
  selectedSkills: SelectedSkillAttachment[];
  onRefresh: () => void;
  onToggleSkill: (skill: SkillListItem) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const selectedIds = useMemo(
    () => new Set(selectedSkills.map((item) => skillIdFromPath(item.name, item.path))),
    [selectedSkills],
  );
  const visibleSkills = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return skills;
    return skills.filter((skill) =>
      [skill.displayName, skill.name, skill.description, skill.path].some((value) => value?.toLowerCase().includes(needle)),
    );
  }, [query, skills]);

  return (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Skills"
      description={`${workspace?.name || '当前工作区'} · 已选 ${selectedSkills.length} 个`}
      snapPoints={['65%', '92%']}
      footer={
        <View className="flex-row gap-2">
          <Button variant="secondary" isDisabled={status === 'loading'} onPress={onRefresh} className="flex-1 rounded-xl">
            <StyledIonicons name="refresh-outline" size={16} className="text-foreground" />
            <Button.Label>刷新</Button.Label>
          </Button>
          <Button variant="primary" isDisabled={!conversationId} onPress={onClose} className="flex-1 rounded-xl">
            <Button.Label>完成</Button.Label>
          </Button>
        </View>
      }
    >
      <View className="gap-3">
        <SearchField value={query} onChange={setQuery}>
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="搜索 Skill" className="min-h-11" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        {status === 'loading' ? <LoadingState label="正在扫描 Skills" /> : null}
        {status === 'error' ? <InlineNotice status="danger" title="加载失败" description={error || 'skills/list 请求失败'} /> : null}
        {status !== 'loading' && visibleSkills.length === 0 ? (
          <EmptyStateView
            icon="flash-outline"
            title={skills.length === 0 ? '没有可选 Skill' : '没有匹配的 Skill'}
            description={skills.length === 0 ? '当前工作区没有返回启用的 Skills。' : '换个关键词再试试。'}
          />
        ) : null}
        {visibleSkills.length > 0 ? (
          <ListSection variant="secondary">
            {visibleSkills.map((skill) => {
              const selected = selectedIds.has(skill.id);
              return (
                <ListRow
                  key={skill.id}
                  title={skill.displayName || skill.name}
                  description={skill.description || skill.path}
                  descriptionLines={2}
                  icon="flash"
                  iconClassName={selected ? 'bg-accent' : 'bg-default'}
                  iconColorClassName={selected ? 'text-accent-foreground' : 'text-foreground'}
                  isDisabled={!skill.enabled}
                  onPress={() => onToggleSkill(skill)}
                  suffix={
                    <View className="flex-row items-center gap-2">
                      <Chip size="sm" variant="soft">
                        <Chip.Label>{skill.scope}</Chip.Label>
                      </Chip>
                      <Checkbox isSelected={selected} isDisabled={!skill.enabled} onSelectedChange={() => onToggleSkill(skill)} />
                    </View>
                  }
                />
              );
            })}
          </ListSection>
        ) : null}
      </View>
    </AppSheet>
  );
}
