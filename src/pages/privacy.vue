<script setup lang="ts">
import { useHead } from '@unhead/vue'
import LegalPage from '../components/LegalPage.vue'
import { LEGAL } from '../config/legal'

definePage({ meta: { layout: 'blank' } })
useHead({ title: `Privacy policy · ${LEGAL.product}` })
</script>

<template>
  <LegalPage title="Privacy policy" :intro="`What ${LEGAL.product} collects, why, who helps us run it, and what you can do about it.`">
    <h2>1. Who is responsible</h2>
    <p>{{ LEGAL.company }} ({{ LEGAL.country }}) runs {{ LEGAL.product }} and decides how your personal data is used. We handle personal data in line with Ghana’s Data Protection Act, 2012 (Act 843).</p>

    <h2>2. What we collect</h2>
    <ul>
      <li><strong>Your account:</strong> name, email address and profile picture from the way you sign in (Google, GitHub, or email and password). We never see your Google or GitHub password. Email passwords are held by our sign-in provider, not by us.</li>
      <li><strong>What you give us:</strong> chat messages, files you attach, memory notes, agents, workflows and the files {{ LEGAL.product }} creates for you.</li>
      <li><strong>Connected apps:</strong> when you connect an app or an MCP server, we hold the connection so it can act for you. We read from or write to it only when you ask, or when a workflow you made runs.</li>
      <li><strong>Keys you paste in:</strong> for services such as Paystack and Arkesel we keep the key you give us, encrypted, only to act for you in that service. We also record when a payment request or text message was sent (not its content) to apply daily limits.</li>
      <li><strong>Usage:</strong> how many credits and tokens you use, and when, to apply plan limits.</li>
      <li><strong>Payments:</strong> when you buy Pro, we keep the reference, amount, date and how long it covers. Card and mobile money details go to our payment provider, not to us.</li>
      <li><strong>Technical logs:</strong> when something breaks we log the error, the page address (without anything after a “?”) and your browser type. We do not log your messages, files or sign-in details in these logs.</li>
      <li><strong>Cookies:</strong> a session cookie and a security cookie that keep you signed in and protect against forged requests. We do not use advertising or tracking cookies.</li>
    </ul>

    <h2>3. Why we use it</h2>
    <ul>
      <li>to run {{ LEGAL.product }} and give you answers, files and automations;</li>
      <li>to apply usage limits, take payment for Pro and send receipts, reminders and the alerts you have switched on;</li>
      <li>to find and fix problems and keep the service secure;</li>
      <li>to answer you when you contact us.</li>
    </ul>
    <p>We do not sell your data and we do not show advertising.</p>

    <h2>4. Who helps us run it</h2>
    <p>We use service providers who process data for us. Which ones see your content depends on what you use:</p>
    <ul>
      <li><strong>Google (Firebase and Google Cloud):</strong> sign-in, our database and hosting.</li>
      <li><strong>AI model providers</strong> (Google, Groq, OpenAI, Anthropic): your messages, attachments and any tool results needed for a reply are sent to the provider of the model you choose. We do not use your content to train models; each provider handles content under its own terms.</li>
      <li><strong>Composio:</strong> manages the sign-in and actions for apps you connect.</li>
      <li><strong>Search and web-reading services:</strong> receive the search terms or page addresses the assistant looks up for you.</li>
      <li><strong>MCP servers you add:</strong> receive the tool requests you approve. Those servers are yours, not ours.</li>
      <li><strong>Payment provider</strong> (Paystack), when you buy Pro: handles card and mobile money details and gets your name and email for the receipt. We do not store card or phone payment details.</li>
      <li><strong>Email provider</strong> (Resend): delivers receipts, Pro-ending reminders and workflow failure alerts to your email address.</li>
    </ul>
    <p>Some providers are outside {{ LEGAL.country }}, so your data can be processed in other countries. We only use providers that protect it with appropriate safeguards. We may also share data if the law requires it.</p>

    <h2>5. How long we keep it</h2>
    <ul>
      <li>Chats, workflows, agents and memory: until you delete them or your account.</li>
      <li>Created files: {{ LEGAL.fileRetentionDays }} days.</li>
      <li>Usage and plan records: until you delete your account.</li>
      <li>Payment records: kept for our accounts and in case of a dispute, as the law expects. When you delete your account they stop being linked to you: your name, email and account are removed, and only the reference, amount and date remain.</li>
      <li>Error logs: kept by Google Cloud for a limited time (about 30 days by default).</li>
    </ul>

    <h2>6. Your choices and rights</h2>
    <ul>
      <li><strong>See and download</strong> your data in Settings → Your data.</li>
      <li><strong>Correct</strong> your name in Settings, and edit or remove memory notes, agents and workflows at any time.</li>
      <li><strong>Switch memory off</strong>, and disconnect any app or MCP server.</li>
      <li><strong>Delete your account</strong> in Settings. This removes your data and disconnects your apps.</li>
      <li>You may also object to how we use your data, or complain to Ghana’s Data Protection Commission. Contact us first and we will do our best to put things right.</li>
    </ul>

    <h2>7. Keeping it safe</h2>
    <p>Data is encrypted in transit. Tokens for MCP servers and keys for services you connect are encrypted before they are stored. The database can only be reached through our server, which checks that you own what you ask for. No system is perfectly safe, so we also limit what we collect and let you delete it.</p>

    <h2>8. Children</h2>
    <p>{{ LEGAL.product }} is not meant for people under 18, and we do not knowingly collect their data. If you think a child has an account, tell us and we will remove it.</p>

    <h2>9. Changes</h2>
    <p>If we change this policy in a way that matters, we will tell you in the app. The date at the top shows when it was last updated.</p>

    <h2>10. Contact</h2>
    <p v-if="LEGAL.contactEmail">For privacy questions or to use your rights: <a :href="`mailto:${LEGAL.contactEmail}`">{{ LEGAL.contactEmail }}</a>.</p>
    <p v-else>For privacy questions or to use your rights, please use the contact details on our website.</p>
  </LegalPage>
</template>
