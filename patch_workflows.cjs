const fs = require('fs');
let code = fs.readFileSync('src/pages/workflows/index.vue', 'utf8');

// Replace Gemini div with USelect
code = code.replace(
  /<div class="p-2 rounded-md border border-default bg-background text-sm text-foreground flex items-center justify-between">[\s\S]*?<span>Gemini 3.5 Flash<\/span>[\s\S]*?<span class="text-\[10px\] px-1.5 py-0.5 rounded bg-primary\/10 text-primary">Google GenAI<\/span>[\s\S]*?<\/div>/g,
  `<USelect
                  :options="[{ label: 'Gemini 3.5 Flash', value: 'gemini-3.5-flash' }, { label: 'Gemini 1.5 Pro', value: 'gemini-1.5-pro' }]"
                  model-value="gemini-3.5-flash"
                  size="md"
                  class="w-full"
                />`
);

// Replace "New Email Received" div with USelect
code = code.replace(
  /<div class="p-2 rounded-md border border-default bg-background text-sm text-foreground">\s*New Email Received\s*<\/div>/g,
  `<USelect
                  :options="[{ label: 'New Email Received', value: 'new_email' }, { label: 'Important Email Received', value: 'important_email' }]"
                  model-value="new_email"
                  size="md"
                  class="w-full"
                />`
);

fs.writeFileSync('src/pages/workflows/index.vue', code);
console.log('Done!');
