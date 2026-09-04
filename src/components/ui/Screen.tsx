import type { ReactNode } from 'react';
import { ScrollView, type ScrollViewProps, View } from 'react-native';
import { Surface, Text } from 'heroui-native';

/** Full-height screen root using the theme background. */
export function Screen({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <Surface variant="transparent" className={`flex-1 bg-background ${className}`}>{children}</Surface>;
}

/**
 * Standard scrolling page body with consistent horizontal padding and a
 * comfortable bottom inset so content clears the home indicator.
 * Automatically centers and constrains maximum width on large/landscape screens.
 */
export function ScreenScrollView({
  children,
  contentContainerClassName = '',
  centerOnWide = true,
  ...props
}: ScrollViewProps & {
  children: ReactNode;
  contentContainerClassName?: string;
  centerOnWide?: boolean;
}) {
  const containerClass = `${centerOnWide ? 'w-full max-w-5xl self-center ' : ''}gap-4 px-4 pb-10 pt-3 ${contentContainerClassName}`;
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName={containerClass}
      {...props}
    >
      {children}
    </ScrollView>
  );
}

/** Small uppercase caption used above list groups and cards. */
export function SectionHeader({
  title,
  description,
  trailing,
  className = '',
}: {
  title: string;
  description?: string;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <View className={`flex-row items-end justify-between gap-3 px-1 ${className}`}>
      <View className="min-w-0 flex-1">
        <Text type="body-sm" weight="semibold" className="uppercase tracking-wide text-muted">
          {title}
        </Text>
        {description ? (
          <Text type="body-xs" color="muted" className="mt-0.5">
            {description}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

/**
 * Intro row for screens whose title already lives in the navigation header:
 * a muted description on the left and an optional chip/action on the right.
 */
export function ScreenIntro({ description, trailing }: { description: string; trailing?: ReactNode }) {
  return (
    <View className="flex-row items-center justify-between gap-3 px-1">
      <Text type="body-sm" color="muted" className="min-w-0 flex-1 leading-5">
        {description}
      </Text>
      {trailing}
    </View>
  );
}

/** Large page heading with optional subtitle and trailing element. */
export function PageHeader({
  title,
  subtitle,
  trailing,
}: {
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
}) {
  return (
    <View className="flex-row items-start justify-between gap-3 px-1">
      <View className="min-w-0 flex-1">
        <Text type="h2" className="text-foreground">
          {title}
        </Text>
        {subtitle ? (
          <Text type="body-sm" color="muted" className="mt-1" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}
