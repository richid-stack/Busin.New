---
name: resume-and-cover-letter
description: Tailor a CV or resume and write a cover letter for a specific job, using only true experience. Use when the user asks to improve, write or tailor a CV, resume, cover letter or LinkedIn summary, or to apply for a role.
---

Goal: a CV and letter that show this person is the right fit for this job, honestly.

**Steps**
1. Get the job: the advert (ask them to paste it, or use `web_fetch` on a link), plus the user's current CV or a description of their work history. Without both, ask for what is missing.
2. List what the employer asks for: required skills, tools, experience, and the words they use. Rank the top five.
3. Match: for each, find real evidence in the user's history. Note gaps honestly; do not cover them with invented experience. A gap can be addressed with related experience or willingness to learn, said plainly.
4. Rewrite the CV bullets so each shows an action and a result with numbers where the user has them ("Cut delivery time from 5 days to 2", not "Responsible for deliveries"). Put the most relevant material first. Keep to one or two pages and a plain layout that application systems can read.
5. Write the cover letter in four short paragraphs: why this role and company (one specific thing), the two strongest matches with evidence, how the user would help, and a closing line. Under 300 words. Use the name of the hiring manager if known.
6. If a file is wanted, make it with `create_document`.

**Output**
- The tailored CV text and the cover letter, ready to copy, then a short list of gaps and how to deal with them.

**Rules**
- Never invent a job, a degree, a number, a skill or a date. Ask when unsure.
- Do not copy the advert's words wholesale; use them where they are true.
- Keep personal details the user gave you in the document only; do not share them elsewhere.
- Keep the tone confident, not boastful. No clichés ("hard-working team player") without proof.
