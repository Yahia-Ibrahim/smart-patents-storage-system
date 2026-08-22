"""
Service responsible for extracting textual content from patent PDF documents.
"""

from __future__ import annotations

import fitz

from app.exceptions import DocumentExtractionException


class DocumentExtractor:
    """
    Extract textual content from patent PDF files.
    """

    def extract_text(self, document_path: str) -> str:
        """
        Extract all readable text from a patent PDF.

        Args:
            document_path: Local path to the downloaded PDF.

        Returns:
            Extracted document text.

        Raises:
            DocumentExtractionException:
                If the document cannot be opened or contains
                no extractable text.
        """

        try:
            document = fitz.open(document_path)

            try:
                pages = [
                    self._extract_page_text(page)
                    for page in document
                ]
            finally:
                document.close()

            text = "\n".join(pages).strip()

            if self._is_empty(text):
                raise DocumentExtractionException(
                    "Document contains no extractable text."
                )

            return text

        except DocumentExtractionException:
            raise

        except Exception as ex:
            raise DocumentExtractionException(
                f"Failed to extract text from '{document_path}'."
            ) from ex

    def _extract_page_text(self, page: fitz.Page) -> str:
        """
        Extract text from a single PDF page.
        """

        return page.get_text().strip()

    @staticmethod
    def _is_empty(text: str) -> bool:
        """
        Return True if the extracted text contains no useful content.
        """

        return not text.strip()