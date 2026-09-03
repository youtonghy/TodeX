import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { WorkbenchTab } from '../lib/workbench';

type ConversationRouteParams = {
  workspaceId: string;
  conversationId: string;
};

export type RootStackParamList = {
  Workspaces: undefined;
  Conversations: { workspaceId: string };
  Chat: ConversationRouteParams;
  SlashCommands: ConversationRouteParams;
  SlashCommandAction: ConversationRouteParams & { command: string };
  Experimental: ConversationRouteParams;
  GitDiff: ConversationRouteParams;
  Terminal: ConversationRouteParams;
  Settings: undefined;
  Capabilities: ConversationRouteParams;
  Browser: ConversationRouteParams & { url?: string; filePath?: string };
  Files: ConversationRouteParams & { filePath?: string };
  Usage: undefined;
  About: undefined;
  Kanban: undefined;
  Workbench: ConversationRouteParams & { tab?: WorkbenchTab };
  Git: ConversationRouteParams;
};

export type AppRouteName = keyof RootStackParamList;
export type AppScreenProps<Name extends AppRouteName> = NativeStackScreenProps<RootStackParamList, Name>;
