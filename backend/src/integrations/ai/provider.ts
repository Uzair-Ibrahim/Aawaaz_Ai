import type {
  ApplicationFieldName,
  DocumentType,
  LanguageCode,
  StructuredExtractionOutput,
} from '@awaaz/shared';

export interface ExtractFieldInput {
  activeField: ApplicationFieldName;
  expectedType: 'string' | 'number' | 'boolean';
  language: LanguageCode;
  transcript: string;
  correctionHint?: string;
}

export interface DocumentExtractionResult {
  detected_document_type: DocumentType | 'unknown';
  readability_score: number;
  extracted_fields: Record<string, string | number | boolean | null>;
  warnings: string[];
  model_name: string;
}

export interface PolicyAnswerInput {
  question: string;
  language: LanguageCode;
  retrievedChunks: Array<{
    title: string;
    section: string;
    source_reference: string;
    chunk_text: string;
  }>;
}

export interface PolicyAnswerOutput {
  answer: string;
  citations: Array<{
    title: string;
    section: string;
    source_reference: string;
  }>;
  grounded: boolean;
  requires_officer_routing: boolean;
  model_name: string;
}

export interface AIProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly embeddingModelName: string;
  isConfigured(): boolean;
  extractStructuredField(input: ExtractFieldInput): Promise<StructuredExtractionOutput>;
  extractDocumentFields(input: {
    fileBuffer: Buffer;
    mimeType: string;
    expectedDocumentType: DocumentType;
  }): Promise<DocumentExtractionResult>;
  embedTexts(texts: string[]): Promise<number[][]>;
  generateGroundedPolicyAnswer(input: PolicyAnswerInput): Promise<PolicyAnswerOutput>;
  generateStructuredJson?(prompt: string, label: string, timeoutMs?: number): Promise<Record<string, unknown> | null>;
}
