import { memo, type ComponentProps } from 'react';

import { AboutScreen, type AboutScreenProps } from '../screens/AboutScreen';
import { ExperimentalScreen } from '../screens/ExperimentalScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { UsageScreen, type UsageScreenProps } from '../screens/UsageScreen';
import type { AppScreenProps } from '../navigation/routes';
import { useAppRuntime, useKeyedStoreValue, useRouteSnapshot } from './appRuntime';

export type ExperimentalRouteSnapshot = Omit<
  ComponentProps<typeof ExperimentalScreen>,
  'navigation' | 'route' | 'workspace' | 'conversation'
>;
export type SettingsRouteSnapshot = Omit<ComponentProps<typeof SettingsScreen>, 'navigation' | 'route'>;
export type UsageRouteSnapshot = UsageScreenProps;
export type AboutRouteSnapshot = AboutScreenProps;

export const EXPERIMENTAL_ROUTE_SNAPSHOT = 'route:experimental';
export const SETTINGS_ROUTE_SNAPSHOT = 'route:settings';
export const USAGE_ROUTE_SNAPSHOT = 'route:usage';
export const ABOUT_ROUTE_SNAPSHOT = 'route:about';

export const ExperimentalRouteScreen = memo(function ExperimentalRouteScreen({ navigation, route }: AppScreenProps<'Experimental'>) {
  const runtime = useAppRuntime();
  const snapshot = useRouteSnapshot<ExperimentalRouteSnapshot>(EXPERIMENTAL_ROUTE_SNAPSHOT);
  const workspace = useKeyedStoreValue(runtime.workspaces, route.params.workspaceId);
  const conversation = useKeyedStoreValue(runtime.conversations, route.params.conversationId);
  if (!snapshot) return null;
  return (
    <ExperimentalScreen
      navigation={navigation}
      route={route}
      workspace={workspace}
      conversation={conversation?.workspaceId === route.params.workspaceId ? conversation : null}
      {...snapshot}
    />
  );
});

export const SettingsRouteScreen = memo(function SettingsRouteScreen({ navigation, route }: AppScreenProps<'Settings'>) {
  const snapshot = useRouteSnapshot<SettingsRouteSnapshot>(SETTINGS_ROUTE_SNAPSHOT);
  if (!snapshot) return null;
  return <SettingsScreen navigation={navigation} route={route} {...snapshot} />;
});

export const UsageRouteScreen = memo(function UsageRouteScreen() {
  const snapshot = useRouteSnapshot<UsageRouteSnapshot>(USAGE_ROUTE_SNAPSHOT);
  return snapshot ? <UsageScreen {...snapshot} /> : null;
});

export const AboutRouteScreen = memo(function AboutRouteScreen() {
  const snapshot = useRouteSnapshot<AboutRouteSnapshot>(ABOUT_ROUTE_SNAPSHOT);
  return snapshot ? <AboutScreen {...snapshot} /> : null;
});
