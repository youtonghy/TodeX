import { useCallback, useRef, useState } from 'react';
import { Modal, Platform, ScrollView, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Chip, Surface, Text } from 'heroui-native';
import { Segment } from 'heroui-native-pro';

import { normalizeServerUrl, type BackendConnectionProfile, type ConnectionSettings } from '../lib/todex';
import { connectionFailureLabel, type ConnectionFailureCode } from '../lib/connectionError';
import {
  applyPairingToSettings,
  assemblePairingQrChunkPayload,
  parsePairingQrFrame,
  resolvePairingPayload,
} from '../lib/transportCrypto';
import {
  connectionStateLabel,
  healthLabelOf,
  latencyLabelOf,
  type ConnectionHealth,
  type ConnectionState,
  type PairingChunkCollector,
  type RootStackParamList,
} from '../lib/appCore';
import {
  ConfirmDialog,
  ConnectionChip,
  FormField,
  FormTextArea,
  InlineNotice,
  Screen,
  ScreenScrollView,
  SectionHeader,
  StyledIonicons,
  useAppToast,
} from '../components/ui';

const ENCRYPTION_OPTIONS: Array<{ value: ConnectionSettings['encryptionProtocol']; label: string }> = [
  { value: 'none', label: '明文' },
  { value: 'ml-kem-768', label: '后量子' },
  { value: 'x25519', label: 'X25519' },
];

export function SettingsScreen({
  settings,
  setSettings,
  connectionState,
  connectionHealth,
  lastError,
  connect,
  closeSocket,
  backendProfiles,
  activeBackendConnectionId,
  updateBackendProfile,
  addBackendProfile,
  removeBackendProfile,
  selectBackendProfile,
}: NativeStackScreenProps<RootStackParamList, 'Settings'> & {
  settings: ConnectionSettings;
  setSettings: React.Dispatch<React.SetStateAction<ConnectionSettings>>;
  connectionState: ConnectionState;
  connectionHealth: ConnectionHealth;
  lastError: string;
  connect: () => void;
  closeSocket: (manual?: boolean) => void;
  backendProfiles: BackendConnectionProfile[];
  activeBackendConnectionId: string;
  updateBackendProfile: (id: string, patch: Partial<BackendConnectionProfile>) => void;
  addBackendProfile: (draft?: Partial<BackendConnectionProfile>) => BackendConnectionProfile | null;
  removeBackendProfile: (id: string) => void;
  selectBackendProfile: (id: string) => void;
}) {
  const toast = useAppToast();
  const insets = useSafeAreaInsets();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [pairingScannerVisible, setPairingScannerVisible] = useState(false);
  const [pairingScannerStatus, setPairingScannerStatus] = useState('对准后端配对二维码。');
  const [deleteProfileVisible, setDeleteProfileVisible] = useState(false);
  const pairingChunkCollectorRef = useRef<PairingChunkCollector | null>(null);
  const pairingScanBusyRef = useRef(false);
  const pairingScannerLastRawRef = useRef<string | null>(null);
  const isConnected = connectionState === 'open';
  const isConnecting = connectionState === 'connecting';
  const connectionActionTitle = isConnected || isConnecting ? '断开连接' : connectionState === 'error' ? '重试连接' : '连接后端';
  const classifiedError = connectionFailureLabel(connectionHealth.code as ConnectionFailureCode | '');
  const connectionAction = isConnected || isConnecting ? () => closeSocket(true) : connect;
  const activeBackendProfile = backendProfiles.find((profile) => profile.id === activeBackendConnectionId) ?? null;
  const connectionErrorText = connectionHealth.status === 'offline' && connectionHealth.error
    ? connectionHealth.error
    : lastError || '';

  const openPairingScanner = useCallback(async () => {
    if (Platform.OS === 'web') {
      toast.warning('当前平台不支持扫码', '请在移动端使用扫码，或手动粘贴二维码里的 JSON。');
      return;
    }
    if (!cameraPermission?.granted) {
      const next = await requestCameraPermission();
      if (!next.granted) {
        toast.warning('需要相机权限', '允许相机权限后才能扫描后端配对二维码。');
        return;
      }
    }
    pairingChunkCollectorRef.current = null;
    setPairingScannerStatus('对准后端配对二维码。');
    pairingScannerLastRawRef.current = null;
    setPairingScannerVisible(true);
  }, [cameraPermission?.granted, requestCameraPermission, toast]);

  const closePairingScanner = useCallback(() => {
    pairingChunkCollectorRef.current = null;
    pairingScanBusyRef.current = false;
    pairingScannerLastRawRef.current = null;
    setPairingScannerVisible(false);
    setPairingScannerStatus('对准后端配对二维码。');
  }, []);

  const applyPairingText = useCallback(async (raw: string) => {
    try {
      const pairing = await resolvePairingPayload(raw);
      setSettings((current) => applyPairingToSettings(current, pairing));
      closePairingScanner();
      const summary = `${pairing.serverUrl} · ${pairing.encryptionProtocol}`;
      toast.success(
        '已填写配对信息',
        pairing.importWarning
          ? `${summary}。已先填写基础信息，${pairing.importWarning}`
          : `${summary}。可在连接前继续手动调整配置。`,
      );
    } catch (error) {
      toast.error('配对失败', error instanceof Error ? error.message : '二维码内容无效');
    }
  }, [closePairingScanner, setSettings, toast]);

  const pastePairingFromClipboard = useCallback(async () => {
    const raw = await Clipboard.getStringAsync();
    await applyPairingText(raw);
  }, [applyPairingText]);

  const handlePairingScan = useCallback((result: BarcodeScanningResult) => {
    if (pairingScanBusyRef.current) {
      return;
    }
    if (pairingScannerLastRawRef.current === result.data) {
      return;
    }
    pairingScannerLastRawRef.current = result.data;
    pairingScanBusyRef.current = true;
    void (async () => {
      try {
        const frame = parsePairingQrFrame(result.data);
        if (frame.kind === 'pairing') {
          await applyPairingText(frame.raw);
          return;
        }

        const existing = pairingChunkCollectorRef.current;
        if (
          !existing ||
          existing.checksum !== frame.chunk.checksum ||
          existing.total !== frame.chunk.total
        ) {
          pairingChunkCollectorRef.current = {
            checksum: frame.chunk.checksum,
            total: frame.chunk.total,
            chunks: new Map(),
          };
          setPairingScannerStatus(`已开始收集分段二维码：0/${frame.chunk.total}`);
        }

        const collector = pairingChunkCollectorRef.current;
        if (!collector) {
          throw new Error('无法收集分段二维码');
        }
        if (frame.chunk.index < 1 || frame.chunk.index > collector.total) {
          throw new Error('分段二维码序号无效');
        }
        if (!collector.chunks.has(frame.chunk.index)) {
          collector.chunks.set(frame.chunk.index, frame.chunk);
          setPairingScannerStatus(`已收集 ${collector.chunks.size}/${collector.total} 段，请继续扫描下一张。`);
        } else {
          setPairingScannerStatus(`已扫描过第 ${frame.chunk.index}/${collector.total} 段，请切换到下一张二维码。`);
        }
        if (collector.chunks.size === collector.total) {
          const assembled = assemblePairingQrChunkPayload([...collector.chunks.values()]);
          pairingChunkCollectorRef.current = null;
          await applyPairingText(assembled);
        }
      } catch (error) {
        pairingChunkCollectorRef.current = null;
        setPairingScannerStatus('扫描失败，请重新开始。');
        toast.error('配对失败', error instanceof Error ? error.message : '二维码内容无效');
      } finally {
        pairingScanBusyRef.current = false;
      }
    })();
  }, [applyPairingText, toast]);

  return (
    <Screen>
      <ScreenScrollView>
        <Surface className="gap-4 rounded-3xl p-4">
          <View className="flex-row items-center gap-3">
            <View
              className={`h-11 w-11 items-center justify-center rounded-2xl ${
                isConnected ? 'bg-success/15' : connectionState === 'error' || connectionHealth.status === 'offline' ? 'bg-danger/15' : 'bg-default'
              }`}
            >
              <StyledIonicons
                name={isConnected ? 'cloud-done-outline' : isConnecting ? 'cloud-upload-outline' : 'cloud-offline-outline'}
                size={22}
                className={isConnected ? 'text-success' : connectionState === 'error' || connectionHealth.status === 'offline' ? 'text-danger' : 'text-muted'}
              />
            </View>
            <View className="min-w-0 flex-1">
              <Text type="h5" className="text-foreground">
                {connectionStateLabel(connectionState)}
              </Text>
              <Text type="body-xs" color="muted" numberOfLines={1}>
                {healthLabelOf(connectionHealth)}
              </Text>
            </View>
            <View className="items-end gap-1">
              <ConnectionChip state={connectionState} />
              <Text type="body-xs" weight="semibold" className="font-mono text-muted">
                {latencyLabelOf(connectionHealth.latencyMs)}
              </Text>
            </View>
          </View>
          {connectionErrorText || classifiedError ? (
            <InlineNotice
              status="danger"
              title={classifiedError || '连接失败'}
              description={connectionErrorText || undefined}
            />
          ) : null}
          <Button
            variant={isConnected || isConnecting ? 'danger-soft' : 'primary'}
            size="lg"
            onPress={connectionAction}
            className="rounded-2xl"
          >
            <StyledIonicons
              name={isConnected || isConnecting ? 'close-circle-outline' : 'flash-outline'}
              size={18}
              className={isConnected || isConnecting ? 'text-danger' : 'text-accent-foreground'}
            />
            <Button.Label>{connectionActionTitle}</Button.Label>
          </Button>
        </Surface>

        <View className="gap-2">
          <SectionHeader
            title="后端配置"
            description={`${backendProfiles.length} 个连接 · 当前 ${activeBackendProfile?.name || '未选择'}`}
            trailing={
              <Button
                size="sm"
                variant="ghost"
                onPress={() => {
                  const created = addBackendProfile({ name: `后端 ${backendProfiles.length + 1}` });
                  if (created) toast.success('已新增后端配置', '请填写地址和凭据后再连接。');
                }}
                className="rounded-full"
              >
                <StyledIonicons name="add" size={16} className="text-foreground" />
                <Button.Label>新增</Button.Label>
              </Button>
            }
          />
          <Surface className="gap-4 rounded-3xl p-4">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
              {backendProfiles.map((profile) => {
                const selected = profile.id === activeBackendConnectionId;
                return (
                  <Chip
                    key={profile.id}
                    size="md"
                    variant={selected ? 'primary' : 'soft'}
                    color={selected ? 'accent' : 'default'}
                    onPress={() => selectBackendProfile(profile.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Chip.Label numberOfLines={1} className="max-w-[180px]">
                      {profile.name}
                    </Chip.Label>
                  </Chip>
                );
              })}
            </ScrollView>
            {activeBackendProfile ? (
              <FormField
                label="配置名称"
                value={activeBackendProfile.name}
                onChangeText={(value) => updateBackendProfile(activeBackendProfile.id, { name: value })}
                placeholder="我的后端"
                trailing={
                  backendProfiles.length > 1 ? (
                    <Button
                      isIconOnly
                      variant="danger-soft"
                      accessibilityLabel="删除后端配置"
                      onPress={() => setDeleteProfileVisible(true)}
                      className="h-12 w-12 rounded-xl"
                    >
                      <StyledIonicons name="trash-outline" size={18} className="text-danger" />
                    </Button>
                  ) : undefined
                }
              />
            ) : null}
          </Surface>
        </View>

        <View className="gap-2">
          <SectionHeader title="服务器" />
          <Surface className="gap-4 rounded-3xl p-4">
            <FormField
              label="Server URL"
              value={settings.serverUrl}
              onChangeText={(value) => setSettings((current) => ({ ...current, serverUrl: value }))}
              onBlur={() => setSettings((current) => ({ ...current, serverUrl: normalizeServerUrl(current.serverUrl) }))}
              placeholder="http://127.0.0.1:7345"
              keyboardType="url"
              monospace
            />
            <FormField
              label="Auth token"
              value={settings.authToken}
              onChangeText={(value) => setSettings((current) => ({ ...current, authToken: value }))}
              placeholder="Bearer token"
              secureTextEntry
            />
            <FormField
              label="Tenant id"
              value={settings.tenantId}
              onChangeText={(value) => setSettings((current) => ({ ...current, tenantId: value }))}
              placeholder="local"
            />
          </Surface>
        </View>

        <View className="gap-2">
          <SectionHeader title="传输加密" description="扫描后端配对二维码可一键填写地址、令牌与密钥" />
          <Surface className="gap-4 rounded-3xl p-4">
            <Segment
              value={settings.encryptionProtocol}
              onValueChange={(value) => setSettings((current) => ({ ...current, encryptionProtocol: value as ConnectionSettings['encryptionProtocol'] }))}
            >
              <Segment.Group>
                <Segment.Indicator />
                {ENCRYPTION_OPTIONS.map((option) => (
                  <Segment.Item key={option.value} value={option.value} className="flex-1">
                    <Segment.Label>{option.label}</Segment.Label>
                  </Segment.Item>
                ))}
              </Segment.Group>
            </Segment>
            <FormTextArea
              label="Key 密钥"
              value={settings.encryptionPublicKey}
              onChangeText={(value) => setSettings((current) => ({ ...current, encryptionPublicKey: value }))}
              placeholder="扫描一键配对二维码后自动填充"
              minHeightClassName="min-h-24"
              monospace
            />
            <View className="flex-row gap-2">
              <Button variant="primary" onPress={() => void openPairingScanner()} className="flex-1 rounded-xl">
                <StyledIonicons name="qr-code-outline" size={16} className="text-accent-foreground" />
                <Button.Label>扫码配对</Button.Label>
              </Button>
              <Button variant="secondary" onPress={() => void pastePairingFromClipboard()} className="flex-1 rounded-xl">
                <StyledIonicons name="clipboard-outline" size={16} className="text-foreground" />
                <Button.Label>粘贴配对内容</Button.Label>
              </Button>
            </View>
          </Surface>
        </View>
      </ScreenScrollView>

      <ConfirmDialog
        isOpen={deleteProfileVisible}
        onOpenChange={setDeleteProfileVisible}
        title="删除后端配置"
        description={`确定删除「${activeBackendProfile?.name ?? ''}」？`}
        confirmLabel="删除"
        destructive
        onConfirm={() => {
          if (activeBackendProfile) removeBackendProfile(activeBackendProfile.id);
        }}
      />

      <Modal visible={pairingScannerVisible} animationType="slide" onRequestClose={closePairingScanner}>
        <View className="flex-1 bg-black">
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handlePairingScan}
          />
          <View className="absolute inset-x-0 top-0 items-end px-4" style={{ paddingTop: insets.top + 8 }}>
            <Button isIconOnly variant="secondary" accessibilityLabel="关闭扫码" onPress={closePairingScanner} className="h-10 w-10 rounded-full">
              <StyledIonicons name="close" size={20} className="text-foreground" />
            </Button>
          </View>
          <View className="absolute inset-x-0 bottom-0 px-4" style={{ paddingBottom: insets.bottom + 16 }}>
            <Surface className="gap-3 rounded-3xl p-4">
              <View className="flex-row items-center gap-3">
                <View className="h-10 w-10 items-center justify-center rounded-2xl bg-accent/15">
                  <StyledIonicons name="qr-code-outline" size={20} className="text-accent" />
                </View>
                <View className="min-w-0 flex-1">
                  <Text type="h6" className="text-foreground">
                    扫描 TodeX 配对二维码
                  </Text>
                  <Text type="body-xs" color="muted" numberOfLines={2}>
                    {pairingScannerStatus}
                  </Text>
                </View>
              </View>
              <Button variant="secondary" onPress={closePairingScanner} className="rounded-xl">
                <Button.Label>取消</Button.Label>
              </Button>
            </Surface>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
