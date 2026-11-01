<script setup lang="ts">
/**
 * The card every "you need to sign in", "could not load" and "nothing here yet" screen is made from, so they
 * look and behave the same everywhere. Same tile, same type sizes, same spacing as before, and it arrives with
 * the app's short rise instead of snapping in.
 */
withDefaults(defineProps<{
  icon: string
  title: string
  text?: string
  /** `plain` is a solid card (sign in, errors); `empty` is the dashed outline used when there is nothing yet. */
  kind?: 'plain' | 'empty'
  tone?: 'neutral' | 'error'
}>(), { text: '', kind: 'plain', tone: 'neutral' })
</script>

<template>
  <div
    class="rise-in rounded-2xl border text-center"
    :class="kind === 'empty' ? 'border-dashed border-default p-10' : 'border-default bg-elevated/50 p-8'"
    :role="tone === 'error' ? 'alert' : undefined"
  >
    <div class="mx-auto mb-4 size-12 rounded-xl border border-default bg-default shadow-sm flex items-center justify-center">
      <UIcon :name="icon" class="size-5" :class="tone === 'error' ? 'text-error' : 'text-muted'" />
    </div>
    <h2 class="text-base font-semibold text-highlighted mb-1">{{ title }}</h2>
    <p v-if="text" class="text-sm text-muted" :class="$slots.default ? 'mb-5' : ''">{{ text }}</p>
    <div v-if="$slots.default" class="flex items-center justify-center gap-2 flex-wrap" :class="text ? '' : 'mt-4'">
      <slot />
    </div>
  </div>
</template>
