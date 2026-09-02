import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Surface, Tabs, Text as HeroText } from 'heroui-native';

export type WorkbenchTab = 'terminal' | 'browser' | 'files' | 'git-diff';

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

const DEFAULT_TABS: readonly WorkbenchTab[] = ['terminal', 'browser', 'files', 'git-diff'];

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
  const icon = TAB_DEFINITIONS[tab].icon;
  return (
    <View className="flex-1 items-center justify-center px-8" accessibilityLabel={`${label}面板`}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={25} color="#66717c" />
      </View>
      <HeroText className="mt-3 text-sm font-semibold text-foreground">{label}面板</HeroText>
      <HeroText className="mt-1 text-center text-xs text-muted">暂无可显示内容</HeroText>
    </View>
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
    const candidates = visibleTabs && visibleTabs.length > 0 ? visibleTabs : DEFAULT_TABS;
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
    <Surface className="flex-1 bg-background">
      <Tabs value={selectedTab} onValueChange={handleTabChange} variant="primary" className="flex-1">
        <View className="border-b border-separator px-4 pb-2 pt-4">
          <View className="flex-row items-center justify-between gap-3">
            <View className="min-w-0 flex-1">
              <HeroText className="text-xl font-semibold text-foreground" numberOfLines={1}>{title}</HeroText>
              {subtitle ? <HeroText className="mt-1 text-xs text-muted" numberOfLines={2}>{subtitle}</HeroText> : null}
            </View>
            {action ? (
              <Button
                size="sm"
                variant="secondary"
                isDisabled={action.isDisabled}
                onPress={action.onPress}
                className="min-h-11"
              >
                {action.icon ? <Ionicons name={action.icon} size={16} color="#52606b" /> : null}
                <Button.Label>{action.label}</Button.Label>
              </Button>
            ) : null}
          </View>
          <Tabs.List className="mt-3">
            <Tabs.ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              scrollAlign="start"
              contentContainerClassName="gap-1"
            >
              <Tabs.Indicator />
              {tabs.map((tab) => {
                const definition = TAB_DEFINITIONS[tab];
                return (
                  <Tabs.Trigger key={tab} value={tab} className="min-h-11 min-w-[88px] flex-row items-center justify-center gap-2 px-3">
                    {({ isSelected }) => (
                      <>
                        <Ionicons name={definition.icon} size={17} color={isSelected ? '#ffffff' : '#52606b'} />
                        <Tabs.Label className={isSelected ? 'text-white' : 'text-muted'}>{labelFor(tab)}</Tabs.Label>
                      </>
                    )}
                  </Tabs.Trigger>
                );
              })}
            </Tabs.ScrollView>
          </Tabs.List>
        </View>
        <View className="flex-1" key={selectedTab}>
          <Tabs.Content value={selectedTab} className="flex-1">
            {rendererFor(selectedTab)}
          </Tabs.Content>
        </View>
      </Tabs>
    </Surface>
  );
}

const styles = StyleSheet.create({
  emptyIcon: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: '#edf0f2',
  },
});
