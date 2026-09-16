const fs = require('fs')

const file = 'src/pages/integrations/[provider].vue'
let content = fs.readFileSync(file, 'utf8')

// Replace the dummy '#' links with actual externalLinks
content = content.replace(
  /<div class="flex items-center justify-between py-4">\s*<span class="text-muted">Website<\/span>\s*<UButton icon="i-lucide-external-link" size="xs" variant="ghost" color="neutral" \/>\s*<\/div>/g,
  `<div class="flex items-center justify-between py-4">
              <span class="text-muted">Website</span>
              <UButton :to="integration.externalLinks?.website || '#'" target="_blank" icon="i-lucide-external-link" size="xs" variant="ghost" color="neutral" />
            </div>`
)

content = content.replace(
  /<div class="flex items-center justify-between py-4">\s*<span class="text-muted">Privacy Policy<\/span>\s*<UButton icon="i-lucide-external-link" size="xs" variant="ghost" color="neutral" \/>\s*<\/div>/g,
  `<div class="flex items-center justify-between py-4">
              <span class="text-muted">Privacy Policy</span>
              <UButton :to="integration.externalLinks?.privacy || '#'" target="_blank" icon="i-lucide-external-link" size="xs" variant="ghost" color="neutral" />
            </div>`
)

content = content.replace(
  /<div class="flex items-center justify-between py-4">\s*<span class="text-muted">Terms of Service<\/span>\s*<UButton icon="i-lucide-external-link" size="xs" variant="ghost" color="neutral" \/>\s*<\/div>/g,
  `<div class="flex items-center justify-between py-4">
              <span class="text-muted">Terms of Service</span>
              <UButton :to="integration.externalLinks?.terms || '#'" target="_blank" icon="i-lucide-external-link" size="xs" variant="ghost" color="neutral" />
            </div>`
)

content = content.replace(
  /<a href="#" class="underline hover:text-foreground">terms<\/a> and <a href="#" class="underline hover:text-foreground">privacy policy<\/a>/g,
  `<a :href="integration.externalLinks?.terms || '#'" target="_blank" class="underline hover:text-foreground">terms</a> and <a :href="integration.externalLinks?.privacy || '#'" target="_blank" class="underline hover:text-foreground">privacy policy</a>`
)

fs.writeFileSync(file, content)
