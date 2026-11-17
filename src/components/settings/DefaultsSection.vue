<script setup lang="ts">
import { computed } from 'vue'
import { useModels } from '../../composables/useModels'
import { usePreferences } from '../../composables/usePreferences'
import SettingRow from './SettingRow.vue'

const { prefs } = usePreferences()
const { items, model } = useModels()

const startMode = computed({
  get: () => (prefs.value.newChatModel ? 'fixed' : 'last'),
  set: (v: 'last' | 'fixed') => { prefs.value.newChatModel = v === 'last' ? '' : (prefs.value.newChatModel || model.value) }
})
const choices = [{ value: 'enter', label: 'Enter sends' }, { value: 'mod', label: 'Ctrl + Enter sends' }] as const
const timeChoices = [{ value: 'relative', label: '2 hours ago' }, { value: 'exact', label: '14:05' }] as const
</script>

<template>
  <div class="divide-y divide-default border-y border-default">
    <SettingRow title="New chats start with" hint="Last used keeps whatever you picked most recently.">
      <UButton label="Last used" size="sm" color="neutral" :variant="startMode === 'last' ? 'solid' : 'subtle'" :aria-pressed="startMode === 'last'" @click="startMode = 'last'" />
      <UButton label="Always this one" size="sm" color="neutral" :variant="startMode === 'fixed' ? 'solid' : 'subtle'" :aria-pressed="startMode === 'fixed'" @click="startMode = 'fixed'" />
      <template v-if="startMode === 'fixed'">
        <USelect v-model="prefs.newChatModel" :items="items" size="sm" class="w-full sm:w-56" aria-label="Model for new chats" />
      </template>
    </SettingRow>

    <SettingRow title="Sending a message" hint="Pick what Enter does. The other one adds a new line.">
      <UButton v-for="c in choices" :key="c.value" :label="c.label" size="sm" color="neutral" :variant="prefs.enterSends === c.value ? 'solid' : 'subtle'" :aria-pressed="prefs.enterSends === c.value" @click="prefs.enterSends = c.value" />
    </SettingRow>

    <SettingRow title="Show times as" hint="In your task and workspace lists.">
      <UButton v-for="c in timeChoices" :key="c.value" :label="c.label" size="sm" color="neutral" :variant="prefs.timeStyle === c.value ? 'solid' : 'subtle'" :aria-pressed="prefs.timeStyle === c.value" @click="prefs.timeStyle = c.value" />
    </SettingRow>
  </div>
</template>
