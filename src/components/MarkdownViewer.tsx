import { memo, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Button, Surface, Text } from 'heroui-native';
import { parseMarkdownBlocks, parseMarkdownInline, type MarkdownBlock } from '../lib/markdown';

type LinkHandler = (href: string) => void;

const InlineFormattedText = memo(function InlineFormattedText({ text, className = 'text-foreground text-base leading-6', onOpenLink }: {
  text: string; className?: string; onOpenLink?: LinkHandler;
}) {
  const tokens = useMemo(() => parseMarkdownInline(text), [text]);
  return <Text selectable className={className}>{tokens.map((token, index) => {
    if (token.type === 'text') return token.text;
    return <Text key={index}
      weight={token.type === 'bold' ? 'bold' : undefined}
      accessibilityRole={token.type === 'link' && onOpenLink ? 'link' : undefined}
      onPress={token.type === 'link' && onOpenLink ? () => onOpenLink(token.href!) : undefined}
      className={token.type === 'code' ? 'font-mono bg-surface-secondary text-foreground' : token.type === 'link' ? 'text-accent underline' : token.type === 'italic' ? 'italic' : ''}
    >{token.text}</Text>;
  })}</Text>;
});

const CodeBlock = memo(function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  return <Surface variant="secondary" className="my-1 min-w-0 overflow-hidden rounded-xl border border-separator p-3">
    <View className="mb-2 flex-row items-center justify-between gap-2">
      <Text type="body-xs" color="muted" className="flex-1 font-mono" numberOfLines={1}>{language || '代码'}</Text>
      <Button size="sm" variant="ghost" accessibilityLabel="复制代码" onPress={() => {
        void Clipboard.setStringAsync(code).then(() => setCopied(code)).catch(() => setCopied(null));
      }}><Button.Label>{copied === code ? '已复制' : '复制'}</Button.Label></Button>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled>
      <Text selectable type="code" className="font-mono text-sm leading-5 text-foreground">{code || ' '}</Text>
    </ScrollView>
  </Surface>;
});

const MarkdownBlockView = memo(function MarkdownBlockView({ block, onOpenLink }: { block: MarkdownBlock; onOpenLink?: LinkHandler }) {
  if (block.type === 'codeblock') return <CodeBlock code={block.code} language={block.language} />;
  if (block.type === 'rule') return <View className="my-2 h-px bg-separator" />;
  if (block.type === 'table') return <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator className="my-1">
    <View className="overflow-hidden rounded-lg border border-separator">
      {[block.header, ...block.rows].map((row, index) => <View key={index} className={`flex-row ${index === 0 ? 'bg-surface-secondary' : 'border-t border-separator'}`}>
        {row.map((cell, column) => <View key={column} style={{ width: 180 }} className={`p-3 ${column ? 'border-l border-separator' : ''}`}>
          <InlineFormattedText text={cell} onOpenLink={onOpenLink} className={`text-sm leading-5 text-foreground ${index === 0 ? 'font-semibold' : ''}`} />
        </View>)}
      </View>)}
    </View>
  </ScrollView>;
  if (block.type === 'bullet' || block.type === 'ordered') return <View className="flex-row items-start gap-2 pl-1">
    <Text className="text-base leading-6 text-muted">{block.type === 'ordered' ? `${block.ordinal}.` : '•'}</Text>
    <View className="min-w-0 flex-1"><InlineFormattedText text={block.text} onOpenLink={onOpenLink} /></View>
  </View>;
  if (block.type === 'quote') return <View className="border-l-2 border-separator pl-3"><InlineFormattedText text={block.text} onOpenLink={onOpenLink} /></View>;
  const className = block.type === 'h1' ? 'mt-2 text-2xl font-bold leading-8 text-foreground'
    : block.type === 'h2' ? 'mt-2 text-xl font-bold leading-7 text-foreground'
    : block.type === 'h3' ? 'mt-1 text-lg font-semibold leading-6 text-foreground'
    : 'text-base leading-6 text-foreground';
  return <InlineFormattedText text={block.text} className={className} onOpenLink={onOpenLink} />;
}, (previous, next) => previous.onOpenLink === next.onOpenLink && JSON.stringify(previous.block) === JSON.stringify(next.block));

/** Inline mode shares the chat list's scrolling; only wide tables/code scroll horizontally. */
export const MarkdownViewer = memo(function MarkdownViewer({ content, inline = false, onOpenLink }: {
  content: string; inline?: boolean; onOpenLink?: LinkHandler;
}) {
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);
  const body = blocks.map((block, index) => <MarkdownBlockView key={index} block={block} onOpenLink={onOpenLink} />);
  return inline ? <View className="min-w-0 gap-2">{body}</View>
    : <ScrollView contentContainerClassName="p-4 pb-12 gap-3">{body}</ScrollView>;
});
