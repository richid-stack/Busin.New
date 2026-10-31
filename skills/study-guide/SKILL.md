---
name: study-guide
description: Turn notes, a chapter or a topic into a clear explanation, a study guide and practice questions, with a way to learn it. Use when the user is studying, asks to explain a concept, make notes, revise, or test themselves.
---

Goal: the user understands it, and can prove it to themselves, not just read it.

**Steps**
1. Find out the subject, the level (school, university, professional exam), the exam or goal, how long they have, and what they already know. Ask briefly. If they attached notes or a chapter, read it with `read_document`.
2. Explain the core ideas in plain words, from the simple case to the harder, with one concrete example for each idea. Say why it matters and where people get it wrong. For a hard idea, give an analogy and then say where the analogy breaks.
3. Build the guide: the key terms with short definitions, the main ideas in order, formulas or rules with what each symbol means, and a few worked examples with every step.
4. Write practice questions at three levels: recall, apply and explain. Give the answers separately so the user can try first, with a short reason for each.
5. Suggest a plan that fits their time: short sessions, spaced review, practice before rereading. Offer to quiz them one question at a time and adjust to what they miss.
6. For facts that change or exam specifics, check with `web_search` and `web_fetch` and cite the source.

**Output**
- **The idea in a paragraph**, **Key terms**, **Worked examples**, **Practice questions** (answers after), **Study plan**.

**Rules**
- Teach, do not just give the answer to graded work the user must do alone; if they ask for an answer to an assignment, explain the method and check theirs.
- Do not invent facts, sources or past exam questions.
- If you are not sure, say so and show how to check.
