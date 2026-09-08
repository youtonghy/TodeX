// HeroUI Pro beta's internal barrel eagerly evaluates Skia chart defaults, even
// for text-only controls. Resolve its named component imports to the same leaf
// modules so unused charts do not initialize (or enter the native bundle).
module.exports = function ({ types: t }) {
  const leaves = {
    AnimatedCheckIcon: 'animated-check-icon',
    FullWindowOverlay: 'full-window-overlay',
    HeroText: 'hero-text',
    PopupOverlayBlurView: 'popup-overlay-blur-view',
    ReText: 're-text',
  };
  return { visitor: { ImportDeclaration(path, state) {
    const filename = (state.filename || '').replace(/\\/g, '/');
    const source = path.node.source.value;
    if (!filename.includes('/heroui-native-pro/') || !source.endsWith('/helpers/internal/components/index.js')) return;
    const imports = [], remaining = [];
    for (const spec of path.node.specifiers) {
      const name = t.isImportSpecifier(spec) && spec.imported.name;
      if (!name || !leaves[name]) { remaining.push(spec); continue; }
      imports.push(t.importDeclaration([
        name === 'ReText' ? t.importDefaultSpecifier(spec.local) : t.importSpecifier(spec.local, spec.imported),
      ], t.stringLiteral(source.replace(/index\.js$/, `${leaves[name]}.js`))));
    }
    if (!imports.length) return;
    if (remaining.length) imports.push(t.importDeclaration(remaining, path.node.source));
    path.replaceWithMultiple(imports);
  } } };
};
