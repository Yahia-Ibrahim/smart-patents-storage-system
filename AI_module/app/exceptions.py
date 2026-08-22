"""Application-specific exceptions."""


class DocumentExtractionException(Exception):
    """Raised when a patent document cannot be processed."""


class EmbeddingGenerationException(Exception):
    """Raised when an embedding cannot be generated."""


class EmbeddingRepositoryException(Exception):
    """Raised when the embedding cache cannot be accessed."""


class VectorStoreException(Exception):
    """Raised when Qdrant operations fail."""


class SimilaritySearchException(Exception):
    """Raised when similarity search fails."""


class ReportGenerationException(Exception):
    """Raised when a similarity report cannot be generated."""