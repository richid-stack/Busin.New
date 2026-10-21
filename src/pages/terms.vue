<script setup lang="ts">
import { useHead } from '@unhead/vue'
import LegalPage from '../components/LegalPage.vue'
import { LEGAL } from '../config/legal'

definePage({ meta: { layout: 'blank' } })
useHead({ title: `Terms of use · ${LEGAL.product}` })
</script>

<template>
  <LegalPage title="Terms of use" :intro="`The rules for using ${LEGAL.product}, in plain English.`">
    <h2>1. Who we are and what this covers</h2>
    <p>{{ LEGAL.product }} is an AI assistant and workflow tool run by {{ LEGAL.company }} in {{ LEGAL.country }} (“we”, “us”). By creating an account or using it, you agree to these terms and to our <RouterLink to="/privacy">Privacy policy</RouterLink>. If you do not agree, please do not use it.</p>

    <h2>2. Your account</h2>
    <ul>
      <li>Use accurate details and keep your sign-in safe. You are responsible for what happens on your account.</li>
      <li>You must be 18 or older to use {{ LEGAL.product }}.</li>
      <li>Tell us if you think someone else has accessed your account.</li>
    </ul>

    <h2>3. What you can and cannot do</h2>
    <p>Use {{ LEGAL.product }} lawfully and fairly. You must not:</p>
    <ul>
      <li>break the law, or use it to harm, harass, defraud or mislead other people;</li>
      <li>create or share content that is illegal, or that sexualises children;</li>
      <li>try to get around usage limits, share one account between many people to avoid them, or resell access without our written agreement;</li>
      <li>probe, attack or overload the service, or try to reach other people’s data;</li>
      <li>use it to build malware or to attack systems you do not have permission to test.</li>
    </ul>
    <p>We may limit or suspend access to protect people or the service, and we will explain why when we can.</p>

    <h2>4. AI answers can be wrong</h2>
    <p>{{ LEGAL.product }} uses AI models. They can make mistakes, miss context and sound sure when they are wrong. Check anything important, especially legal, financial, medical, tax or safety matters, before you act on it. The assistant gives information, not professional advice.</p>

    <h2>5. Connected apps and automations</h2>
    <p>When you connect an app (such as Google, Microsoft or Slack), add an MCP server or build a workflow, you allow {{ LEGAL.product }} to act on your behalf within what you connected. Scheduled workflows run without you watching. You are responsible for the workflows you create and for the apps and servers you choose to connect. You can disconnect anything at any time, and steps that need approval wait for it.</p>

    <h2>6. Your content</h2>
    <p>What you put in (messages, files, notes, workflows) stays yours. You give us permission to store it and to process it, including by sending it to the AI and other service providers named in the Privacy policy, only as needed to run the service for you. You promise you have the right to use what you upload.</p>

    <h2>7. Usage limits, plans and payment</h2>
    <p>Use is counted in credits, per day and per month, and each plan has its own limits. We may change limits, and we show your current usage in Settings. Pro is bought in advance for 1 or 12 months, by card or mobile money, through our payment provider. The price is shown before you pay. Time you buy is added to any Pro time you have left, and nothing renews automatically. When Pro ends you return to the Free plan and keep your data. Taxes may apply. If a payment went through but Pro did not start, contact us with your payment reference and we will fix it.</p>

    <h2>8. Created files</h2>
    <p>Files {{ LEGAL.product }} creates for you are kept for {{ LEGAL.fileRetentionDays }} days so you can download them. Download what you want to keep.</p>

    <h2>9. The service, as it is</h2>
    <p>We work to keep {{ LEGAL.product }} available and accurate, but we cannot promise it will never be interrupted or free of errors. Features may change. It is provided “as is”, to the fullest extent the law allows.</p>

    <h2>10. Our responsibility</h2>
    <p>To the extent the law allows, we are not responsible for losses that come from AI mistakes, outages, actions taken in your connected apps on your instructions, or third-party services. Where the law does not allow a limit, it does not apply. Nothing here limits responsibility that cannot lawfully be limited.</p>

    <h2>11. Ending your use</h2>
    <p>You can stop at any time and delete your account in Settings, which removes your data. We may end or suspend an account that breaks these terms. Sections that by their nature should continue (such as 4, 10 and 13) do.</p>

    <h2>12. Changes</h2>
    <p>We may update these terms. When the changes matter, we will tell you in the app. Using {{ LEGAL.product }} after that means you accept the new terms.</p>

    <h2>13. Law and disputes</h2>
    <p>These terms are governed by the laws of {{ LEGAL.country }}. We would like to hear about a problem first and try to sort it out together; if that does not work, the courts of {{ LEGAL.country }} have jurisdiction.</p>

    <h2>14. Contact</h2>
    <p v-if="LEGAL.contactEmail">Questions about these terms: <a :href="`mailto:${LEGAL.contactEmail}`">{{ LEGAL.contactEmail }}</a>.</p>
    <p v-else>Questions about these terms: please use the contact details on our website.</p>
  </LegalPage>
</template>
