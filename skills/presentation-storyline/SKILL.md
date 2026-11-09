---
name: presentation-storyline
description: Plan the story of a presentation (message, audience, one idea per slide) and then build the deck. Use when the user asks for slides, a pitch deck, a talk or a presentation, or has a topic and a deadline for presenting.
---

Goal: a deck that makes one argument to a specific audience, not a pile of slides about a topic.

**Steps**
1. Find out the audience, what they should think or do afterwards, how long the talk is, and any material to use (notes, a document, figures). Ask for what is missing in one message. A short talk is about one slide per minute or fewer.
2. State the main message in one sentence. If you cannot, the deck is not ready; ask.
3. Write the storyline as slide titles that read as sentences: "Sales grew 18 percent, driven by the new Kumasi shop", not "Sales". Read down the titles alone: they should tell the whole story. Typical shape: situation, problem or opportunity, the answer, the evidence, what it costs or needs, what happens next.
4. Show the storyline to the user as a numbered list and wait for a yes or changes, unless they asked you to go straight to the file.
5. Build the deck with `create_presentation`: one idea per slide, a title that states it, at most 5 short bullets or one chart or picture. Put speaker notes in for anything you would say that is not on the slide. Use `chart` for numbers that compare or change over time. Look up current figures with `web_search` and `web_fetch`, and cite the source on the slide.

**Output**
- The storyline first, then the file.
- A line on what you left out and why, and what you could not verify.

**Rules**
- No slide of just a topic word; no wall of text; no filler slides.
- Never invent figures, quotes or logos. If a number is missing, leave a clearly marked placeholder.
- Keep the same style across slides and keep one idea per slide.
