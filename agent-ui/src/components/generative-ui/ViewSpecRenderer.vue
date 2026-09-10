<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { buildAtmsViewModel, type GenerativeUiCompositionItemV1, type GenerativeUiStoredNodeV1, type GenerativeUiSurfaceContextV1 } from 'atms-protocol'
import ViewSpecNode from './ViewSpecNode'
import type { GenerativeUiPreviewRequestV1 } from '@/generative-ui/types'

const props = defineProps<{
  node: GenerativeUiStoredNodeV1
  placement: GenerativeUiCompositionItemV1
  context: GenerativeUiSurfaceContextV1
  expanded?: boolean
}>()
const emit = defineEmits<{
  (event: 'request-action', actionId: string): void
  (event: 'open-preview', payload: GenerativeUiPreviewRequestV1): void
}>()
const { locale } = useI18n()
const model = computed(() => {
  if (!props.node.view) throw new Error(`Generated View node has no ViewSpec: ${props.node.id}`)
  return buildAtmsViewModel(props.node.view, props.node.content, { locale: locale.value })
})
</script>

<template>
  <section class="atms-view-spec" :data-variant="placement.variant" :data-viewport="context.viewport" :data-expanded="expanded ? 'true' : 'false'">
    <ViewSpecNode
      :model="model.root"
      :compact="context.viewport === 'compact'"
      :expanded="expanded"
      @request-action="emit('request-action', $event)"
      @open-preview="emit('open-preview', $event)"
    />
  </section>
</template>

<style>
.atms-view-spec { --atms-gap-xs:6px; --atms-gap-sm:10px; --atms-gap-md:16px; --atms-gap-lg:24px; min-width:0; height:100%; min-height:100%; color:var(--atms-text-1); font-size:14px; }
.atms-view__node { min-width:0; }
.atms-view__stack,.atms-view__repeat { display:grid; align-content:start; }
.atms-view__grid,.atms-view__repeat { display:grid; grid-template-columns:repeat(var(--columns),minmax(0,1fr)); align-content:start; }
.atms-view__node[data-gap="none"] { gap:0; }.atms-view__node[data-gap="xs"] { gap:var(--atms-gap-xs); }.atms-view__node[data-gap="sm"] { gap:var(--atms-gap-sm); }.atms-view__node[data-gap="md"] { gap:var(--atms-gap-md); }.atms-view__node[data-gap="lg"] { gap:var(--atms-gap-lg); }
.atms-view__node[data-align="start"] { align-items:start; }.atms-view__node[data-align="center"] { align-items:center; }.atms-view__node[data-align="end"] { align-items:end; }.atms-view__node[data-align="stretch"] { align-items:stretch; }
.atms-view__section { display:grid; gap:11px; border-top:1px solid var(--atms-border); padding-top:12px; }
.atms-view__section > header { color:var(--atms-accent); font-size:12px; font-weight:850; text-transform:uppercase; }
.atms-view__heading { min-width:0; margin:0; overflow-wrap:anywhere; color:var(--atms-text-1); line-height:1.16; letter-spacing:0; text-wrap:balance; }.atms-view__heading:is(h1) { font-size:32px; }.atms-view__heading:is(h2) { font-size:26px; }.atms-view__heading:is(h3) { font-size:19px; }
.atms-view-spec > .atms-view__stack > .atms-view__heading:first-child { padding-right:44px; }
.atms-view__text,.atms-view__markdown { display:-webkit-box; margin:0; overflow:hidden; color:var(--atms-text-2); font-size:14px; line-height:1.6; white-space:pre-wrap; -webkit-box-orient:vertical; -webkit-line-clamp:var(--max-lines); }
.atms-view__markdown > :first-child { margin-top:0; }.atms-view__markdown > :last-child { margin-bottom:0; }.atms-view__markdown a { color:var(--atms-accent); }
.atms-view__icon { display:grid; place-items:center; width:34px; height:34px; border:1px solid var(--atms-border); border-radius:7px; color:var(--atms-text-3); background:var(--atms-surface-1); }
.atms-view__badge { display:inline-flex; width:max-content; align-items:center; border:1px solid var(--atms-border); border-radius:999px; padding:5px 9px; color:var(--atms-text-3); background:var(--atms-surface-1); font-size:11px; font-weight:800; }
.atms-view__node[data-tone="positive"] { --tone:var(--atms-success); }.atms-view__node[data-tone="info"] { --tone:var(--atms-accent); }.atms-view__node[data-tone="warning"] { --tone:var(--atms-warning); }.atms-view__node[data-tone="critical"] { --tone:var(--atms-danger); }.atms-view__node[data-tone="neutral"] { --tone:var(--atms-text-3); }
.atms-view__badge,.atms-view__icon { border-color:color-mix(in srgb,var(--tone) 34%,transparent); color:var(--tone); }
.atms-view__divider { width:100%; margin:0; border:0; border-top:1px solid var(--atms-border); }
.atms-view__metric { display:grid; min-height:92px; align-content:center; border:1px solid var(--atms-border); border-left:3px solid var(--tone); border-radius:7px; padding:12px 14px; background:var(--atms-surface-1); }
.atms-view__metric span { color:var(--atms-text-3); font-size:12px; }.atms-view__metric strong { margin-top:4px; color:var(--atms-text-1); font-size:28px; }.atms-view__metric small { margin-left:5px; color:var(--atms-text-3); font-size:11px; }
.atms-view__progress { display:grid; gap:9px; }.atms-view__progress > header { display:flex; justify-content:space-between; gap:10px; color:var(--atms-text-2); font-size:12px; }.atms-view__progress-track { height:7px; overflow:hidden; border-radius:999px; background:var(--atms-border); }.atms-view__progress-track i { display:block; height:100%; border-radius:inherit; background:var(--tone); transition:width .25s ease; }
.atms-view__list,.atms-view__timeline { display:grid; gap:8px; margin:0; padding:0; list-style:none; }.atms-view__list li { display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:10px; align-items:center; border-bottom:1px solid var(--atms-border); padding:10px 1px; }.atms-view__list li > i { width:8px; height:8px; border-radius:999px; background:var(--tone,var(--atms-text-3)); }.atms-view__list strong,.atms-view__list p { margin:0; }.atms-view__list strong { font-size:14px; }.atms-view__list p { margin-top:3px; color:var(--atms-text-3); font-size:12px; }.atms-view__list li > span { border-radius:999px; padding:4px 7px; color:var(--atms-text-3); background:var(--atms-surface-1); font-size:10px; }
.atms-view__table-scroll { overflow:auto; border:1px solid var(--atms-border); border-radius:7px; }.atms-view__table { width:100%; border-collapse:collapse; font-size:13px; }.atms-view__table th,.atms-view__table td { padding:11px 12px; border-bottom:1px solid var(--atms-border); text-align:left; white-space:nowrap; }.atms-view__table th { color:var(--atms-accent); font-size:11px; text-transform:uppercase; }.atms-view__table td { color:var(--atms-text-2); }
.atms-view__timeline li { position:relative; display:grid; grid-template-columns:auto minmax(0,1fr); gap:4px 11px; padding:5px 0 12px; }.atms-view__timeline li > i { grid-row:1 / span 2; width:10px; height:10px; margin-top:4px; border:2px solid var(--tone,var(--atms-text-3)); border-radius:999px; }.atms-view__timeline time { color:var(--atms-text-3); font-size:10px; }.atms-view__timeline strong { font-size:14px; }.atms-view__timeline p { margin:4px 0 0; color:var(--atms-text-3); font-size:12px; }
.atms-view__bar_chart { display:grid; gap:10px; }.atms-view__bar_chart > div { display:grid; grid-template-columns:minmax(90px,.7fr) minmax(120px,2fr) auto; gap:10px; align-items:center; font-size:12px; }.atms-view__bar_chart > div > i { height:7px; overflow:hidden; border-radius:999px; background:var(--atms-border); }.atms-view__bar_chart > div > i b { display:block; height:100%; border-radius:inherit; background:var(--tone,var(--atms-accent)); }
.atms-view__action { min-height:38px; border:1px solid var(--atms-border-strong); border-radius:6px; padding:0 14px; color:var(--atms-text-1); background:var(--atms-surface-1); font:inherit; font-size:13px; font-weight:800; cursor:pointer; }.atms-view__action[data-style="primary"] { border-color:var(--atms-accent-border); background:var(--atms-accent-soft); }.atms-view__action[data-style="danger"] { border-color:var(--atms-danger-border); color:var(--atms-danger); }
.atms-view__disclosure { border-top:1px solid var(--atms-border); padding-top:10px; }.atms-view__disclosure summary { color:var(--atms-text-1); font-size:13px; font-weight:800; cursor:pointer; }.atms-view__disclosure > div { display:grid; gap:10px; margin-top:10px; }
.atms-view__link { display:inline-flex; width:max-content; align-items:center; gap:6px; color:var(--atms-accent); font-size:13px; font-weight:750; text-decoration:none; }
.atms-view__artifact { position:relative; min-height:160px; overflow:hidden; border:1px solid var(--atms-accent-border); border-radius:7px; background:var(--atms-control); color:var(--atms-text-1); }
button.atms-view__artifact { display:grid; width:100%; padding:0; text-align:left; cursor:pointer; }
.atms-view__artifact img { width:100%; height:100%; min-height:160px; max-height:360px; object-fit:cover; transition:transform .24s ease; }
.atms-view__artifact:hover img { transform:scale(1.015); }
.atms-view__artifact > span { position:absolute; right:0; bottom:0; left:0; display:grid; gap:3px; padding:28px 14px 13px; background:linear-gradient(transparent,var(--atms-overlay)); }
.atms-view__artifact strong { font-size:15px; }.atms-view__artifact small,.atms-view__artifact p { color:var(--atms-text-3); font-size:12px; }
div.atms-view__artifact { display:grid; min-height:220px; }
.atms-view-spec > div.atms-view__artifact { height:100%; }
.atms-view__artifact iframe { width:100%; height:100%; min-height:180px; border:0; background:#fff; pointer-events:none; }
.atms-view-spec > div.atms-view__artifact > iframe { pointer-events:auto; }
a.atms-view__artifact { display:flex; min-height:92px; align-items:center; gap:12px; padding:16px; text-decoration:none; }
a.atms-view__artifact span { position:static; padding:0; background:none; }
.atms-view-spec[data-variant="summary"][data-expanded="false"] button.atms-view__artifact { min-height:88px; place-items:center; }
.atms-view-spec[data-variant="summary"][data-expanded="false"] button.atms-view__artifact img { width:auto; height:88px; min-height:0; max-width:100%; max-height:88px; object-fit:contain; }
.atms-view-spec[data-variant="summary"][data-expanded="false"] .atms-view__artifact > span { padding:20px 10px 8px; }
.atms-view-spec[data-variant="summary"][data-expanded="false"] .atms-view__artifact strong { font-size:13px; }
.atms-view-spec[data-expanded="true"] { height:100%; }
.atms-view-spec[data-expanded="true"] > .atms-view__stack { min-height:100%; }
.atms-view-spec[data-expanded="true"] div.atms-view__artifact { min-height:max(520px,calc(100dvh - 190px)); }
.atms-view-spec[data-expanded="true"] button.atms-view__artifact { min-height:240px; place-items:center; }
.atms-view-spec[data-expanded="true"] button.atms-view__artifact img { width:auto; height:auto; min-height:0; max-width:100%; max-height:min(52dvh,560px); object-fit:contain; }
.atms-view-spec[data-expanded="true"] .atms-view__artifact iframe { min-height:max(460px,calc(100dvh - 236px)); pointer-events:auto; }
.atms-view__dag-scroll { overflow:auto; border:1px solid var(--atms-border); border-radius:7px; background-image:linear-gradient(var(--atms-surface-1) 1px,transparent 1px),linear-gradient(90deg,var(--atms-surface-1) 1px,transparent 1px); background-size:24px 24px; }.atms-view__dag { position:relative; }.atms-view__dag > svg { position:absolute; inset:0; width:100%; height:100%; }.atms-view__dag > svg > path { fill:none; stroke:var(--atms-border-strong); stroke-width:1.5; stroke-dasharray:5 5; animation:atms-view-edge 1.5s linear infinite; }.atms-view__dag marker path { fill:var(--atms-text-3); }.atms-view__dag-node { position:absolute; display:grid; grid-template-columns:auto minmax(0,1fr); gap:7px; align-content:center; border:1px solid color-mix(in srgb,var(--tone) 45%,var(--atms-border-strong)); border-radius:7px; padding:10px 11px 13px; background:var(--atms-panel); }.atms-view__dag-node > svg { color:var(--tone); }.atms-view__dag-node strong,.atms-view__dag-node span { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.atms-view__dag-node strong { font-size:13px; }.atms-view__dag-node span { margin-top:3px; color:var(--atms-text-3); font-size:11px; }.atms-view__dag-node > i { position:absolute; right:10px; bottom:7px; left:10px; height:3px; overflow:hidden; background:var(--atms-border); }.atms-view__dag-node > i b { display:block; width:var(--progress); height:100%; background:var(--tone); }
@keyframes atms-view-edge { to { stroke-dashoffset:-20; } }
.atms-view-spec[data-viewport="compact"] .atms-view__heading:is(h1,h2) { font-size:22px; line-height:1.22; }
.atms-view-spec[data-viewport="compact"] :is(.atms-view__grid,.atms-view__repeat) { grid-template-columns:repeat(var(--compact-columns),minmax(0,1fr)); }
.atms-view-spec[data-viewport="compact"] .atms-view__node { grid-column:span 1 !important; }
.atms-view-spec[data-viewport="compact"] :is(.atms-view__grid,.atms-view__repeat)[data-compact-columns="2"] > .atms-view__node:last-child:nth-child(odd) { grid-column:1 / -1 !important; }
@media (prefers-reduced-motion:reduce) { .atms-view-spec * { animation:none !important; transition:none !important; } }
</style>
