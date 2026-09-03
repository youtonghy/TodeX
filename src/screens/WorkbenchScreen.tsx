import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import type { Ionicons } from '@expo/vector-icons';
import { Button, Text } from 'heroui-native';
import { Segment } from 'heroui-native-pro';

import { EmptyStateView, Screen, StyledIonicons } from '../components/ui';
import { WORKBENCH_TABS, type WorkbenchTab } from '../lib/workbench';
export type { WorkbenchTab } from '../lib/workbench';

export type WorkbenchContentRenderer = ReactNode | (() => ReactNode);

export type WorkbenchAction = {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  isDisabled?: boolean;
};

export type WorkbenchScreenProps = {
  /** Controlled tab value. Omit this prop to let the shell manage selection locally. */
  activeTab?: WorkbenchTab;
  /** Initial tab used when activeTab is omitted. */
  defaultActiveTab?: WorkbenchTab;
  onTabChange?: (tab: WorkbenchTab) => void;
  /** Hide tabs that are not supported by the current workspace/session. */
  visibleTabs?: readonly WorkbenchTab[];
  tabLabels?: Partial<Record<WorkbenchTab, string>>;
  title?: string;
  subtitle?: string;
  action?: WorkbenchAction;
  /** Called before the per-tab renderers and can replace any tab's content. */
  renderContent?: (tab: WorkbenchTab) => ReactNode | undefined;
  tabContent?: Partial<Record<WorkbenchTab, WorkbenchContentRenderer>>;
  renderTerminal?: WorkbenchContentRenderer;
  renderBrowser?: WorkbenchContentRenderer;
  renderFiles?: WorkbenchContentRenderer;
  renderGitDiff?: WorkbenchContentRenderer;
  /** Fallback content when a tab-specific renderer is not supplied. */
  children?: ReactNode;
};

type TabDefinition = {
  value: WorkbenchTab;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const TAB_DEFINITIONS: Record<WorkbenchTab, TabDefinition> = {
  terminal: { value: 'terminal', label: '终端', icon: 'terminal-outline' },
  browser: { value: 'browser', label: '浏览器', icon: 'globe-outline' },
  files: { value: 'files', label: '文件', icon: 'folder-outline' },
  'git-diff': { value: 'git-diff', label: 'Git Diff', icon: 'git-compare-outline' },
};

function resolveRenderer(renderer: WorkbenchContentRenderer | undefined): ReactNode | undefined {
  return typeof renderer === 'function' ? renderer() : renderer;
}

function EmptyWorkbenchTab({ tab, label }: { tab: WorkbenchTab; label: string }) {
  return (
    <EmptyStateView
      icon={TAB_DEFINITIONS[tab].icon}
      title={`${label}面板`}
      description="暂无可显示内容"
      className="flex-1 justify-center"
    />
  );
}

export function WorkbenchScreen({
  activeTab,
  defaultActiveTab = 'terminal',
  onTabChange,
  visibleTabs,
  tabLabels,
  title = '工作台',
  subtitle,
  action,
  renderContent,
  tabContent,
  renderTerminal,
  renderBrowser,
  renderFiles,
  renderGitDiff,
  children,
}: WorkbenchScreenProps) {
  const tabs = useMemo<WorkbenchTab[]>(() => {
    const candidates = visibleTabs && visibleTabs.length > 0 ? visibleTabs : WORKBENCH_TABS;
    return [...new Set(candidates)].filter((value): value is WorkbenchTab => value in TAB_DEFINITIONS);
  }, [visibleTabs]);
  const firstTab = tabs[0] || 'terminal';
  const [localTab, setLocalTab] = useState<WorkbenchTab>(
    tabs.includes(defaultActiveTab) ? defaultActiveTab : firstTab,
  );
  const requestedTab = activeTab ?? localTab;
  const selectedTab = tabs.includes(requestedTab) ? requestedTab : firstTab;

  const handleTabChange = useCallback((value: string) => {
    if (!tabs.includes(value as WorkbenchTab)) return;
    const nextTab = value as WorkbenchTab;
    setLocalTab(nextTab);
    onTabChange?.(nextTab);
  }, [onTabChange, tabs]);

  const rendererFor = useCallback((tab: WorkbenchTab): ReactNode => {
    const custom = renderContent?.(tab);
    if (custom !== undefined) return custom;

    const configured = tabContent?.[tab];
    if (configured !== undefined) return resolveRenderer(configured);

    const renderer = {
      terminal: renderTerminal,
      browser: renderBrowser,
      files: renderFiles,
      'git-diff': renderGitDiff,
    }[tab];
    const resolved = resolveRenderer(renderer);
    if (resolved !== undefined) return resolved;
    return children ?? <EmptyWorkbenchTab tab={tab} label={tabLabels?.[tab] || TAB_DEFINITIONS[tab].label} />;
  }, [children, renderBrowser, renderContent, renderFiles, renderGitDiff, renderTerminal, tabContent, tabLabels]);

  const labelFor = (tab: WorkbenchTab) => tabLabels?.[tab] || TAB_DEFINITIONS[tab].label;

  return (
    <Screen>
      <View className="gap-3 px-4 pb-3 pt-3">
        <View className="flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text type="h4" className="text-foreground" numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text type="body-xs" color="muted" numberOfLines={2} className="mt-0.5">
                {subtitle}
              </Text>
            ) : null}
          </View>
          {action ? (
            <Button size="sm" variant="primary" isDisabled={action.isDisabled} onPress={action.onPress} className="h-9 rounded-full">
              {action.icon ? <StyledIonicons name={action.icon} size={15} className="text-accent-foreground" /> : null}
              <Button.Label>{action.label}</Button.Label>
            </Button>
          ) : null}
        </View>
        <Segment value={selectedTab} onValueChange={handleTabChange} size="sm">
          <Segment.Group>
            <Segment.ScrollView horizontal showsHorizontalScrollIndicator={false} scrollAlign="start">
              <Segment.Indicator />
              {tabs.map((tab) => {
                const definition = TAB_DEFINITIONS[tab];
                return (
                  <Segment.Item key={tab} value={tab} className="flex-row items-center gap-1.5 px-3">
                    {({ isSelected }) => (
                      <>
                        <StyledIonicons name={definition.icon} size={14} className={isSelected ? 'text-foreground' : 'text-muted'} />
                        <Segment.Label>{labelFor(tab)}</Segment.Label>
                      </>
                    )}
                  </Segment.Item>
                );
              })}
            </Segment.ScrollView>
          </Segment.Group>
        </Segment>
      </View>
      <View className="flex-1" key={selectedTab}>
        {rendererFor(selectedTab)}
      </View>
    </Screen>
  );
}
