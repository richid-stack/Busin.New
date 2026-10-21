import type { ConnectorDef } from './types'

/** Paystack: take payments. Endpoints and fields are from Paystack's API reference. */
export const PAYSTACK: ConnectorDef = {
  provider: 'paystack',
  name: 'Paystack',
  icon: 'i-lucide-wallet-cards',
  category: 'ghana',
  description: 'Look up payments and customers, check your balance, and create payment links for cards and mobile money.',
  baseUrl: 'https://api.paystack.co',
  fields: [
    { id: 'secretKey', label: 'Secret key', placeholder: 'sk_live_… or sk_test_…', secret: true, pattern: /^sk_(live|test)_[A-Za-z0-9]{10,}$/, help: 'Paystack dashboard → Settings → API Keys & Webhooks.' }
  ],
  auth: { type: 'bearer', field: 'secretKey' },
  links: { website: 'https://paystack.com', docs: 'https://paystack.com/docs/api/', getKey: 'https://dashboard.paystack.com/#/settings/developers' },
  keyAdvice: 'A Paystack secret key can do everything on your account. OpenLobs only uses the few actions listed on this page (it cannot send money, refund or change settings), but start with a test key (sk_test_…) to try it safely.',
  verifyAction: 'paystack_get_balance',
  actions: [
    {
      id: 'paystack_get_balance', name: 'Check balance', description: 'See the balance on your Paystack account.',
      method: 'GET', path: '/balance', effect: 'read', params: []
    },
    {
      id: 'paystack_list_transactions', name: 'List transactions', description: 'List recent payments, newest first, optionally only successful, failed or abandoned ones.',
      method: 'GET', path: '/transaction', effect: 'read',
      send: { perPage: 'perPage', page: 'page', status: 'status' },
      params: [
        { name: 'perPage', description: 'How many to return (1 to 50).', type: 'number', min: 1, max: 50, default: 20 },
        { name: 'page', description: 'Page number, starting at 1.', type: 'number', min: 1, max: 1000 },
        { name: 'status', description: 'Only payments with this status.', type: 'enum', values: ['success', 'failed', 'abandoned'] }
      ]
    },
    {
      id: 'paystack_verify_transaction', name: 'Check one payment', description: 'Check what happened to one payment, using its reference.',
      method: 'GET', path: '/transaction/verify/{reference}', effect: 'read',
      params: [{ name: 'reference', description: 'The payment reference.', type: 'string', required: true, maxLength: 100, pattern: /^[A-Za-z0-9._=-]+$/ }]
    },
    {
      id: 'paystack_list_customers', name: 'List customers', description: 'List customers who have paid you.',
      method: 'GET', path: '/customer', effect: 'read',
      send: { perPage: 'perPage', page: 'page' },
      params: [
        { name: 'perPage', description: 'How many to return (1 to 50).', type: 'number', min: 1, max: 50, default: 20 },
        { name: 'page', description: 'Page number, starting at 1.', type: 'number', min: 1, max: 1000 }
      ]
    },
    {
      id: 'paystack_create_payment_link', name: 'Create a payment request', description: 'Start a payment of an amount in cedis and get a link the customer opens to pay by card or mobile money. No money moves until the customer pays.',
      method: 'POST', path: '/transaction/initialize', effect: 'write', dailyLimit: 50,
      send: { email: 'email', amount: 'amount', currency: 'currency' },
      fixed: { channels: ['card', 'mobile_money'] },
      params: [
        { name: 'email', description: 'The customer\'s email address.', type: 'string', required: true, maxLength: 254, pattern: /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/ },
        { name: 'amount', description: 'The amount in cedis, for example 150.50.', type: 'amount', required: true, min: 1, max: 100000 },
        { name: 'currency', description: 'Currency code.', type: 'enum', values: ['GHS'], default: 'GHS' }
      ],
      summarize: (b) => ({ paymentLink: b?.data?.authorization_url, reference: b?.data?.reference })
    }
  ]
}

/** Arkesel: send SMS in Ghana. Endpoint, header and fields are from Arkesel's SMS API v2 guide. */
export const ARKESEL: ConnectorDef = {
  provider: 'arkesel',
  name: 'Arkesel SMS',
  icon: 'i-lucide-message-square-text',
  category: 'ghana',
  description: 'Send text messages to customers in Ghana from your own Arkesel sender name.',
  baseUrl: 'https://sms.arkesel.com',
  fields: [
    { id: 'apiKey', label: 'API key', placeholder: 'Your Arkesel API key', secret: true, pattern: /^[A-Za-z0-9=_-]{16,200}$/, help: 'Arkesel dashboard → SMS API.' }
  ],
  auth: { type: 'header', header: 'api-key', field: 'apiKey' },
  links: { website: 'https://arkesel.com', docs: 'https://arkesel.com/developer-api/sms-api/', getKey: 'https://sms.arkesel.com' },
  keyAdvice: 'Each message uses credit from your Arkesel account. OpenLobs sends to at most 20 numbers at a time and at most 200 messages a day, and only when you ask or a workflow you built runs.',
  actions: [
    {
      id: 'arkesel_send_sms', name: 'Send SMS', description: 'Send a text message to one or more phone numbers.',
      method: 'POST', path: '/api/v2/sms/send', effect: 'write', dailyLimit: 200,
      send: { sender: 'sender', message: 'message', recipients: 'recipients' },
      params: [
        { name: 'sender', description: 'Your registered sender name (up to 11 letters or numbers).', type: 'string', required: true, maxLength: 11, pattern: /^[A-Za-z0-9]{2,11}$/ },
        { name: 'message', description: 'The text to send.', type: 'string', required: true, maxLength: 480 },
        { name: 'recipients', description: 'Phone numbers in international format without +, e.g. 233244000000.', type: 'string_list', required: true, maxItems: 20, maxLength: 15, pattern: /^[0-9]{9,15}$/ }
      ]
    }
  ]
}

export const CONNECTORS: ConnectorDef[] = [PAYSTACK, ARKESEL]

export const getConnector = (provider: string): ConnectorDef | undefined => CONNECTORS.find(c => c.provider === provider)
