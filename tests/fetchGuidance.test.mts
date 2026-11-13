import { fetchGuidance } from '../server/services/design/guidance'

const assert = (c: any, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }

assert(fetchGuidance([]) === '' && fetchGuidance(['web_search', 'calculator']) === '', 'a chat without these tools pays for none of the guidance')
const files = fetchGuidance(['fetch_file', 'view_image'])
assert(/FILES AND IMAGES/.test(files) && !/STUDYING A DESIGN/.test(files) && /never instructions/.test(files), 'file tools bring only the file guidance, and treat content as data')
const study = fetchGuidance(['look_at_page', 'design_tokens'])
assert(/STUDYING A DESIGN/.test(study) && /original work/.test(study) && /look-alike login, payment/.test(study), 'studying a design states the original-work and no-look-alike rules')
assert(/three rounds/.test(study) && /ask the user for a screenshot/.test(study), 'the loop has a stop rule and a fallback when a site blocks visitors')
assert(/never save without a yes/.test(study), 'taste is saved only with a yes')
assert(/CC-BY/.test(fetchGuidance(['find_icons'])) && !/STUDYING/.test(fetchGuidance(['find_icons'])), 'icons guidance asks for credit when a licence needs it')
const code = fetchGuidance(['github_read'])
assert(/public repositories only/.test(code) && /safety check/.test(code), 'code reading is public and read-only, and Reef results name their safety status')
const all = fetchGuidance(['fetch_file', 'look_at_page', 'find_fonts', 'community_search'])
assert(all.split('**').filter(x => /^[A-Z ]+:$/.test(x)).length === 4 && all.length < 4200, 'all four sections together stay short (token cost)')
assert(/plain everyday words/.test(fetchGuidance(['find_icons'])) && fetchGuidance([]) === '', 'the guidance ends with a plain-words reminder, and only when there is guidance')
const runG = fetchGuidance(['run_on_computer', 'look_in_folder'])
assert(/RUNNING THINGS/.test(runG) && /once on a card/.test(runG) && /no pipes/.test(runG) && /switched off/.test(runG) && /\.env/.test(runG) && /never start something that keeps running/i.test(runG) && /two failed plans/.test(runG), 'running guidance: one approval for a plan, no shell, setup code off, no secrets, no servers, stop after two failures')
assert(!/RUNNING THINGS/.test(fetchGuidance(['fetch_file'])) && runG.length < 3200, 'it only appears with the run tools, and stays short')
