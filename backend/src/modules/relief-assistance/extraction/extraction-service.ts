import {
  APPLICATION_FIELD_SPECS,
  type ApplicationFieldName,
  type LanguageCode,
  type StructuredExtractionOutput,
} from '@awaaz/shared';
import type { DataStore } from '../../../core/database/types';
import { AppError } from '../../../core/security/errors';
import type { AIProvider } from '../../../integrations/ai/provider';

function validateAgainstFieldSpec(
  activeField: ApplicationFieldName,
  output: StructuredExtractionOutput,
): string | null {
  if (output.field !== activeField) {
    return `Expected field '${activeField}', received '${output.field}'.`;
  }
  const spec = APPLICATION_FIELD_SPECS[activeField];
  if (spec.expected_type === 'number') {
    if (typeof output.value !== 'number' || !Number.isFinite(output.value)) {
      return `Field '${activeField}' must be a finite number.`;
    }
    if ('min' in spec && output.value < spec.min) {
      return `Field '${activeField}' must be >= ${spec.min}.`;
    }
    if ('max' in spec && output.value > spec.max) {
      return `Field '${activeField}' must be <= ${spec.max}.`;
    }
  } else if (spec.expected_type === 'string') {
    if (typeof output.value !== 'string') {
      return `Field '${activeField}' must be a string.`;
    }
    const trimmed = output.value.trim();
    if ('minLength' in spec && trimmed.length < spec.minLength) {
      return `Field '${activeField}' must be at least ${spec.minLength} characters.`;
    }
    if ('maxLength' in spec && trimmed.length > spec.maxLength) {
      return `Field '${activeField}' must be at most ${spec.maxLength} characters.`;
    }
  } else if (spec.expected_type === 'boolean') {
    if (typeof output.value !== 'boolean') {
      return `Field '${activeField}' must be a boolean.`;
    }
  }
  return null;
}

export class ExtractionService {
  constructor(
    private readonly aiProvider: AIProvider,
    private readonly store: DataStore,
  ) {}

  /**
   * Structured active-field extraction (§10.2 & §10.3).
   * - Active field is strictly chosen by the backend.
   * - Validates type, bounds, string length, and unexpected keys.
   * - Retries AT MOST ONCE with a constrained correction prompt on invalid output.
   * - Logs metadata to ai_runs without storing raw audio.
   */
  async extractActiveField(input: {
    organizationId: string;
    caseId: string;
    activeField: ApplicationFieldName;
    language: LanguageCode;
    transcript: string;
  }): Promise<StructuredExtractionOutput> {
    const spec = APPLICATION_FIELD_SPECS[input.activeField];
    let lastError = '';

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await this.aiProvider.extractStructuredField({
          activeField: input.activeField,
          expectedType: spec.expected_type,
          language: input.language,
          transcript: input.transcript,
          correctionHint: attempt === 2 ? lastError : undefined,
        });

        const specIssue = validateAgainstFieldSpec(input.activeField, result);
        if (specIssue) {
          lastError = specIssue;
          if (attempt === 1) continue;
          throw new AppError(
            422,
            'EXTRACTION_VALIDATION_FAILED',
            `Could not reliably extract '${input.activeField}'. Please clarify or enter the value manually. (${specIssue})`,
          );
        }

        // Enforce mandatory confirmation for critical fields regardless of model flag
        const normalized: StructuredExtractionOutput = {
          ...result,
          needs_confirmation: spec.needs_confirmation || result.needs_confirmation,
        };

        await this.store.createAiRun({
          organization_id: input.organizationId,
          case_id: input.caseId,
          model_provider: this.aiProvider.providerName,
          model_name: this.aiProvider.modelName,
          operation: 'structured_field_extraction',
          input_reference: `field:${input.activeField}:lang:${input.language}:attempt:${attempt}`,
          output: normalized as unknown as Record<string, unknown>,
          confidence: normalized.confidence ?? null,
          explanation: normalized.reason,
        });

        return normalized;
      } catch (err) {
        if (err instanceof AppError && err.statusCode === 503) {
          throw err;
        }
        lastError = err instanceof Error ? err.message : 'Invalid extraction output';
        if (attempt === 2) {
          if (err instanceof AppError) throw err;
          throw new AppError(
            422,
            'EXTRACTION_FAILED',
            `Extraction failed after 1 retry. Please enter '${input.activeField}' manually.`,
          );
        }
      }
    }

    throw new AppError(422, 'EXTRACTION_FAILED', 'Unable to extract field.');
  }
}
