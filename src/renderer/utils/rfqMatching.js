function normalizeMatchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s/\\()（）【】\[\]：:、,_\-—–.]+/g, '');
}

function candidateIdentity(candidate) {
  return [
    candidate.model,
    candidate.reference,
    candidate.productName,
    candidate.description,
    candidate.code
  ].map(normalizeMatchText).filter(Boolean);
}

function getCandidateMatchScore(target, candidate) {
  const targetReference = normalizeMatchText(target?.reference);
  const targetCode = normalizeMatchText(target?.code);
  const targetDescription = normalizeMatchText(target?.description);
  const identities = candidateIdentity(candidate);
  let score = 0;

  if (targetReference && identities.includes(targetReference)) score += 100;
  if (targetCode && identities.includes(targetCode)) score += 90;
  if (
    targetReference &&
    identities.some(value => value.includes(targetReference) || targetReference.includes(value))
  ) score += 45;
  if (
    targetDescription &&
    identities.some(value =>
      value.length >= 4 &&
      (value.includes(targetDescription) || targetDescription.includes(value))
    )
  ) score += 25;
  return score;
}

function flattenQuoteSet(quoteSet) {
  let index = 0;
  return (quoteSet?.batches || []).flatMap(batch =>
    (batch.items || []).map(item => ({
      ...item,
      _quoteEntryId: quoteSet.id,
      _quoteItemIndex: index++,
      _quoteSetName: quoteSet.name,
      _category: batch.category || '无分类'
    }))
  );
}

function sortCandidatesForTarget(target, candidates) {
  return candidates
    .map(candidate => ({
      candidate,
      score: getCandidateMatchScore(target, candidate)
    }))
    .sort((left, right) =>
      right.score - left.score ||
      String(left.candidate.supplierName || '').localeCompare(
        String(right.candidate.supplierName || ''),
        'zh-CN'
      )
    );
}

module.exports = {
  normalizeMatchText,
  getCandidateMatchScore,
  flattenQuoteSet,
  sortCandidatesForTarget
};
