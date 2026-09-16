const fs = require('fs')

const file = 'src/pages/integrations/index.vue'
let content = fs.readFileSync(file, 'utf8')

const badgesCode = `
                <div class="flex flex-wrap items-center gap-2 mt-2">
                  <span v-if="item.supportedEventsCount !== undefined" class="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary ring-1 ring-inset ring-primary/20">
                    Trigger: {{ item.supportedEventsCount }}
                  </span>
                  <span v-if="item.supportedActionsCount !== undefined" class="inline-flex items-center rounded-md bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400 ring-1 ring-inset ring-blue-500/20">
                    Action: {{ item.supportedActionsCount }}
                  </span>
                  <span class="inline-flex items-center rounded-md bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-xs font-medium text-muted ring-1 ring-inset ring-neutral-200 dark:ring-neutral-700">
                    Auth: {{ item.type === 'native' ? 'Google OAuth' : 'Managed Connector' }}
                  </span>
                </div>
`

content = content.replace(
  /<p class="text-sm text-muted line-clamp-1 leading-snug">\{\{ item.description \}\}<\/p>/g,
  `<p class="text-sm text-muted line-clamp-1 leading-snug">{{ item.description }}</p>${badgesCode}`
)

fs.writeFileSync(file, content)
