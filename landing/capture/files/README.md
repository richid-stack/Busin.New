# Sample files for the landing page

`mk_docs.py` generates the sample documents, sheets and slide shown in the carousel (python-docx, openpyxl, python-pptx). The contents are sample content, not output from a live run.

Render: `soffice --headless --convert-to pdf --outdir pdf out/*`, then `pdftoppm -r 170 -f 1 -l 1 -png`, crop to the content and save as webp into `landing/media/files/`.
