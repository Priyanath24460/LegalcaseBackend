/**
 * Validates user input for legal question queries
 * Prevents nonsensical or spam-like input from being processed
 */

export const validateQuestion = (question) => {
  const errors = [];
  
  // 1. Check if question exists and is a string
  if (!question || typeof question !== 'string') {
    return {
      isValid: false,
      errors: ['Question is required and must be text'],
      message: 'Please enter a valid question'
    };
  }

  // Trim whitespace
  const trimmedQuestion = question.trim();

  // 2. Check minimum length
  if (trimmedQuestion.length < 10) {
    errors.push('Question must be at least 10 characters long');
  }

  // 3. Check maximum length (prevent abuse)
  if (trimmedQuestion.length > 1000) {
    errors.push('Question is too long (maximum 1000 characters)');
  }

  // 4. Check for repeated characters (like KKKKKK)
  const repeatedCharPattern = /(.)\1{5,}/; // Same character repeated 6+ times
  if (repeatedCharPattern.test(trimmedQuestion)) {
    errors.push('Question contains too many repeated characters');
  }

  // 5. Check if question contains meaningful words (at least 2-3 letter words)
  const wordPattern = /\b[a-zA-Z]{2,}\b/g;
  const words = trimmedQuestion.match(wordPattern);
  if (!words || words.length < 2) {
    errors.push('Question must contain at least 2 meaningful words');
  }

  // 6. Check for gibberish - ratio of consonants to vowels shouldn't be too extreme
  const letters = trimmedQuestion.replace(/[^a-zA-Z]/g, '');
  const vowels = letters.match(/[aeiouAEIOU]/g);
  const consonants = letters.match(/[bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ]/g);
  
  if (letters.length > 5) {
    const vowelRatio = vowels ? vowels.length / letters.length : 0;
    // Typical English has ~40% vowels, flag if < 10% or > 70%
    if (vowelRatio < 0.10 || vowelRatio > 0.70) {
      errors.push('Question appears to be nonsensical or gibberish');
    }
  }

  // 7. Check if question has at least some spaces (word separation)
  const spaceCount = (trimmedQuestion.match(/\s/g) || []).length;
  if (spaceCount < 1 && trimmedQuestion.length > 20) {
    errors.push('Question should contain spaces between words');
  }

  // 8. Check for minimum alphabetic content (at least 50% should be letters)
  const alphabeticChars = (trimmedQuestion.match(/[a-zA-Z]/g) || []).length;
  const alphaRatio = alphabeticChars / trimmedQuestion.length;
  if (alphaRatio < 0.5) {
    errors.push('Question should contain primarily text characters');
  }

  // 9. Check for common legal/question words (optional - provides better UX)
  const hasQuestionPattern = /\b(what|when|where|who|why|how|can|is|are|was|were|will|would|should|does|do|did|explain|tell|find|show|cases|case|law|legal|rights|contracts?|dispute|violation|precedent|court|section|act|ruling|judgment)\b/i;
  const hasLegalContext = hasQuestionPattern.test(trimmedQuestion);
  
  if (!hasLegalContext && errors.length === 0) {
    // This is a soft warning, not a hard error
    return {
      isValid: true,
      warning: 'Your question might benefit from more specific legal terms or clear question words (what, how, etc.)',
      question: trimmedQuestion
    };
  }

  // Return validation result
  if (errors.length > 0) {
    return {
      isValid: false,
      errors: errors,
      message: 'Please enter a meaningful legal question. ' + errors[0]
    };
  }

  return {
    isValid: true,
    question: trimmedQuestion
  };
};

/**
 * Sanitize question to prevent injection attacks
 */
export const sanitizeQuestion = (question) => {
  if (!question) return '';
  
  // Remove any potential script tags or dangerous patterns
  let sanitized = question
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '');
  
  return sanitized.trim();
};

/**
 * Complete validation pipeline
 */
export const validateAndSanitize = (question) => {
  // First sanitize
  const sanitized = sanitizeQuestion(question);
  
  // Then validate
  const validation = validateQuestion(sanitized);
  
  return {
    ...validation,
    question: validation.isValid ? sanitized : null
  };
};
