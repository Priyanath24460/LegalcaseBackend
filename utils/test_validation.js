/**
 * Test examples for question validation
 * Run this in Node.js to see how validation works
 */

import { validateAndSanitize } from './questionValidator.js';

console.log('=== Question Validation Test Examples ===\n');

const testCases = [
  {
    name: 'Valid Question',
    input: 'What are the legal precedents for property disputes in Sri Lanka?',
    expected: 'Valid'
  },
  {
    name: 'Gibberish Input',
    input: 'KKKKKKKsicinccccnic',
    expected: 'Invalid - repeated characters'
  },
  {
    name: 'Too Short',
    input: 'hello',
    expected: 'Invalid - too short'
  },
  {
    name: 'Random Characters',
    input: 'asdfghjklzxcvbnm',
    expected: 'Invalid - gibberish (low vowel ratio)'
  },
  {
    name: 'No Spaces',
    input: 'whatisthelegalrequirements',
    expected: 'Invalid - no word separation'
  },
  {
    name: 'Too Many Symbols',
    input: '!@#$%^&*()123456',
    expected: 'Invalid - not enough alphabetic content'
  },
  {
    name: 'Valid Without Legal Terms',
    input: 'I need help understanding something about this issue',
    expected: 'Valid (with warning suggestion)'
  },
  {
    name: 'Repeated Letters',
    input: 'aaaaaaaaaaaaa',
    expected: 'Invalid - repeated characters'
  },
  {
    name: 'Only One Word',
    input: 'contractlaw',
    expected: 'Invalid - needs at least 2 words'
  },
  {
    name: 'Valid with Question Words',
    input: 'How do I file a case for breach of contract?',
    expected: 'Valid'
  }
];

testCases.forEach((test, index) => {
  console.log(`\n--- Test ${index + 1}: ${test.name} ---`);
  console.log(`Input: "${test.input}"`);
  console.log(`Expected: ${test.expected}`);
  
  const result = validateAndSanitize(test.input);
  
  console.log(`Result: ${result.isValid ? '✅ VALID' : '❌ INVALID'}`);
  
  if (!result.isValid) {
    console.log(`Errors:`, result.errors);
    console.log(`Message: "${result.message}"`);
  } else if (result.warning) {
    console.log(`⚠️  Warning: ${result.warning}`);
  }
  
  console.log('---');
});

console.log('\n=== End of Tests ===\n');

// Example HTTP response format
console.log('\n=== Example API Response for Invalid Input ===\n');
const invalidInput = 'KKKKKKKsicinccccnic';
const validation = validateAndSanitize(invalidInput);

const apiResponse = {
  error: "Invalid question",
  message: validation.message,
  details: validation.errors,
  topSections: [],
  topCases: [],
  summary: validation.message
};

console.log(JSON.stringify(apiResponse, null, 2));
