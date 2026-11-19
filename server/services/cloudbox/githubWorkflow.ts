import { RUNNER_SCRIPT, RUNNER_SCRIPT_VERSION } from './githubRunnerScript.generated'

/** The one repo OpenLobs uses in a person's GitHub. It is theirs; OpenLobs only ever sends plans to it. */
export const RUNNER_REPO = 'openlobs-runs'
export const WORKFLOW_FILE = 'openlobs-run.yml'
export const WORKFLOW_PATH = `.github/workflows/${WORKFLOW_FILE}`
export const SCRIPT_PATH = '.github/openlobs/run.mjs'
export const RESULT_ARTIFACT = 'openlobs-result'
/** The most a plan may weigh once packed. GitHub accepts 65,535 characters for all of a run's inputs together. */
export const MAX_PACKED_CHARS = 60_000

/**
 * The workflow OpenLobs writes into the repo. Written to be read: it only starts when OpenLobs asks (workflow_dispatch),
 * checks out nothing but the run script, keeps no credentials in the checkout, gives the job read-only access, and
 * hands the plan to the script as data (an environment variable), never pasted into a command.
 */
export const WORKFLOW_YAML = `# OpenLobs run. Written by OpenLobs and safe to read. Deleting this repo removes everything.
# runner ${RUNNER_SCRIPT_VERSION}
name: OpenLobs run
run-name: openlobs \${{ inputs.run_id }}
on:
  workflow_dispatch:
    inputs:
      run_id:
        description: Which run this is
        required: true
        type: string
      plan:
        description: The plan, packed
        required: true
        type: string
permissions:
  contents: read
jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 8
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
          sparse-checkout: .github/openlobs
      - name: Run the plan
        env:
          OPENLOBS_PLAN: \${{ inputs.plan }}
          OPENLOBS_RESULT: \${{ runner.temp }}/result.json
        run: node .github/openlobs/run.mjs
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: ${RESULT_ARTIFACT}
          path: \${{ runner.temp }}/result.json
          retention-days: 1
          if-no-files-found: ignore
`

export const RUNNER_FILES: Array<{ path: string, content: string }> = [
  { path: WORKFLOW_PATH, content: WORKFLOW_YAML },
  { path: SCRIPT_PATH, content: RUNNER_SCRIPT }
]
