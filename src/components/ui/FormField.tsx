import type { ReactNode } from 'react';
import { View, type TextInputProps } from 'react-native';
import { Button, Description, Input, Label, TextArea, TextField } from 'heroui-native';

import { StyledIonicons } from './StyledIonicons';

type BaseFieldProps = {
  label?: string;
  value: string;
  onChangeText: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  description?: string;
  editable?: boolean;
  secureTextEntry?: boolean;
  autoFocus?: boolean;
  keyboardType?: TextInputProps['keyboardType'];
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: () => void;
  monospace?: boolean;
  trailing?: ReactNode;
};

/** Single-line text field. */
export function FormField({
  label,
  value,
  onChangeText,
  onBlur,
  placeholder,
  description,
  editable = true,
  secureTextEntry = false,
  autoFocus = false,
  keyboardType,
  returnKeyType,
  onSubmitEditing,
  monospace = false,
  trailing,
}: BaseFieldProps) {
  return (
    <TextField isDisabled={!editable} className="w-full gap-1.5">
      {label ? <Label>{label}</Label> : null}
      <View className="w-full flex-row items-center gap-2">
        <Input
          containerClassName="flex-1"
          value={value}
          onChangeText={onChangeText}
          onBlur={onBlur}
          placeholder={placeholder}
          secureTextEntry={secureTextEntry}
          autoFocus={autoFocus}
          keyboardType={keyboardType}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          autoCapitalize="none"
          autoCorrect={false}
          className={`min-h-12 flex-1${monospace ? ' font-mono text-sm' : ''}`}
        />
        {trailing}
      </View>
      {description ? <Description>{description}</Description> : null}
    </TextField>
  );
}

/** Multi-line text field. */
export function FormTextArea({
  label,
  value,
  onChangeText,
  onBlur,
  placeholder,
  description,
  editable = true,
  minHeightClassName = 'min-h-28',
  monospace = false,
}: Omit<BaseFieldProps, 'secureTextEntry' | 'trailing'> & { minHeightClassName?: string }) {
  return (
    <TextField isDisabled={!editable} className="w-full gap-1.5">
      {label ? <Label>{label}</Label> : null}
      <TextArea
        containerClassName="w-full"
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        className={`${minHeightClassName}${monospace ? ' font-mono text-sm' : ''}`}
      />
      {description ? <Description>{description}</Description> : null}
    </TextField>
  );
}

/** Text field with a trailing "browse" button used for filesystem paths. */
export function PathField({
  onBrowse,
  browseLabel = '浏览目录',
  ...props
}: BaseFieldProps & { onBrowse?: () => void; browseLabel?: string }) {
  return (
    <FormField
      {...props}
      monospace
      trailing={
        onBrowse ? (
          <Button
            isIconOnly
            size="md"
            variant="secondary"
            accessibilityLabel={browseLabel}
            onPress={onBrowse}
            isDisabled={props.editable === false}
            className="h-12 w-12 rounded-xl"
          >
            <StyledIonicons name="folder-open-outline" size={18} className="text-foreground" />
          </Button>
        ) : undefined
      }
    />
  );
}
