"""
Generates similarity reports for submitted patents.
"""

from __future__ import annotations

from app.exceptions.exceptions import ReportGenerationException
from app.models.dto import (
    PatentSubmittedEventDTO,
    PatentApprovedEventDTO,
    SimilarityReportDTO,
    SearchResultDTO,
)


class ReportGenerator:
    """
    Creates structured similarity reports.
    """

    def generate_report(
        self, payload: PatentSubmittedEventDTO | PatentApprovedEventDTO, matches: list[SearchResultDTO],
    ) -> SimilarityReportDTO:
        """
        Generate a similarity report.
        """
        try:

            return SimilarityReportDTO(
                patent_id=payload.patentId,
                title=payload.title,
                matches=matches,
            )

        except Exception as ex:

            raise ReportGenerationException(
                "Failed to generate similarity report."
            ) from ex