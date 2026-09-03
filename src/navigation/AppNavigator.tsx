import { memo } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { enableScreens } from 'react-native-screens';

import { CapabilitiesRouteScreen, KanbanRouteScreen, SlashCommandActionRouteScreen, SlashCommandsRouteScreen } from '../runtime/CommandRuntimeScreens';
import { ConversationsRouteScreen } from '../runtime/ConversationRuntimeScreen';
import { AboutRouteScreen, ExperimentalRouteScreen, SettingsRouteScreen, UsageRouteScreen } from '../runtime/LeafRuntimeScreens';
import { GitDiffRouteScreen, TerminalRouteScreen } from '../runtime/OutputRuntimeScreens';
import { BrowserRouteScreen, FilesRouteScreen, GitRouteScreen, WorkbenchRouteScreen } from '../runtime/ToolRuntimeScreens';
import { WorkspacesRouteScreen } from '../runtime/WorkspaceRuntimeScreen';
import { ChatRouteScreen } from '../runtime/ChatRuntimeScreen';
import { useAppNavigationTheme } from '../theme/navigation';
import { navigationRef } from './navigationRef';
import type { RootStackParamList } from './routes';

enableScreens(true);
const Stack = createNativeStackNavigator<RootStackParamList>();

export const AppNavigator = memo(function AppNavigator() {
  const { statusBarStyle, navigationTheme, screenOptions } = useAppNavigationTheme();
  return (
    <NavigationContainer ref={navigationRef} theme={navigationTheme}>
      <StatusBar style={statusBarStyle} />
      <Stack.Navigator initialRouteName="Workspaces" screenOptions={screenOptions}>
        <Stack.Screen name="Workspaces" component={WorkspacesRouteScreen} options={{ title: '工作区' }} />
        <Stack.Screen name="Conversations" component={ConversationsRouteScreen} />
        <Stack.Screen name="Chat" component={ChatRouteScreen} />
        <Stack.Screen name="SlashCommands" component={SlashCommandsRouteScreen} options={{ title: 'Slash Commands' }} />
        <Stack.Screen name="SlashCommandAction" component={SlashCommandActionRouteScreen} options={{ title: 'Command' }} />
        <Stack.Screen name="GitDiff" component={GitDiffRouteScreen} options={{ title: 'Git Diff' }} />
        <Stack.Screen name="Terminal" component={TerminalRouteScreen} options={{ title: '终端' }} />
        <Stack.Screen name="Experimental" component={ExperimentalRouteScreen} options={{ title: 'Experimental' }} />
        <Stack.Screen name="Capabilities" component={CapabilitiesRouteScreen} options={{ title: 'Skills 和 MCPs' }} />
        <Stack.Screen name="Settings" component={SettingsRouteScreen} options={{ title: '设置' }} />
        <Stack.Screen name="Usage" component={UsageRouteScreen} options={{ title: '使用统计' }} />
        <Stack.Screen name="About" component={AboutRouteScreen} options={{ title: '关于 TodeX' }} />
        <Stack.Screen name="Kanban" component={KanbanRouteScreen} options={{ title: '看板' }} />
        <Stack.Screen name="Browser" component={BrowserRouteScreen} options={{ title: '浏览器' }} />
        <Stack.Screen name="Files" component={FilesRouteScreen} options={{ title: '文件' }} />
        <Stack.Screen name="Workbench" component={WorkbenchRouteScreen} options={{ title: '工作台' }} />
        <Stack.Screen name="Git" component={GitRouteScreen} options={{ title: 'Git 操作' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
});
