import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { View } from 'react-native';
import { ListGroup, Separator } from 'heroui-native';
import type { ComponentProps } from 'react';

import { StyledIonicons } from './StyledIonicons';

type IoniconName = ComponentProps<typeof StyledIonicons>['name'];

/**
 * Grouped list container that automatically inserts separators between its
 * children, matching the iOS settings-style grouping used across the app.
 */
export function ListSection({
  children,
  variant = 'default',
  className = '',
}: {
  children: ReactNode;
  variant?: 'default' | 'secondary' | 'tertiary' | 'transparent';
  className?: string;
}) {
  const items = Children.toArray(children).filter((child) => isValidElement(child) || typeof child === 'string');
  return (
    <ListGroup variant={variant} className={`overflow-hidden rounded-2xl ${className}`}>
      {items.map((child, index) => (
        <Fragment key={isValidElement(child) && child.key != null ? child.key : index}>
          {index > 0 ? <Separator className="ml-4" /> : null}
          {child}
        </Fragment>
      ))}
    </ListGroup>
  );
}

export function ListRow({
  title,
  description,
  icon,
  iconClassName = 'bg-default',
  iconColorClassName = 'text-foreground',
  prefix,
  suffix,
  showChevron = false,
  onPress,
  onLongPress,
  isDisabled = false,
  titleLines = 1,
  descriptionLines = 1,
  className = '',
  accessibilityLabel,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: IoniconName;
  iconClassName?: string;
  iconColorClassName?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  showChevron?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  isDisabled?: boolean;
  titleLines?: number;
  descriptionLines?: number;
  className?: string;
  accessibilityLabel?: string;
}) {
  const interactive = Boolean(onPress || onLongPress) && !isDisabled;
  return (
    <ListGroup.Item
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!interactive}
      accessibilityRole={interactive ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      className={`min-h-14 gap-3 px-4 py-3 ${isDisabled ? 'opacity-50' : ''} ${className}`}
    >
      {prefix ? (
        <ListGroup.ItemPrefix>{prefix}</ListGroup.ItemPrefix>
      ) : icon ? (
        <ListGroup.ItemPrefix>
          <View className={`h-9 w-9 items-center justify-center rounded-xl ${iconClassName}`}>
            <StyledIonicons name={icon} size={18} className={iconColorClassName} />
          </View>
        </ListGroup.ItemPrefix>
      ) : null}
      <ListGroup.ItemContent className="min-w-0">
        <ListGroup.ItemTitle numberOfLines={titleLines}>{title}</ListGroup.ItemTitle>
        {typeof description === 'string' || typeof description === 'number' ? (
          <ListGroup.ItemDescription numberOfLines={descriptionLines}>{description}</ListGroup.ItemDescription>
        ) : description ? (
          <View>{description}</View>
        ) : null}
      </ListGroup.ItemContent>
      {suffix ? <ListGroup.ItemSuffix>{suffix}</ListGroup.ItemSuffix> : showChevron ? <ListGroup.ItemSuffix /> : null}
    </ListGroup.Item>
  );
}
