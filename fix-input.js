const fs = require('fs');
let content = fs.readFileSync('src/pages/chat/[id].vue', 'utf8');
content = content.replace(/<input\n                ref="fileInput"\n                type="file"\n                multiple\n                class="hidden"\n                accept="image\/\*,application\/pdf,text\/plain,\.doc,\.docx"\n                @change="handleFileSelect"\n              \/>/g, '<input\n                ref="fileInput"\n                type="file"\n                multiple\n                class="hidden"\n                accept="image/*,application/pdf,text/plain,.doc,.docx"\n                @change="handleFileSelect"\n              >');
fs.writeFileSync('src/pages/chat/[id].vue', content);
