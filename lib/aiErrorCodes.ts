// lib/aiErrorCodes.ts
// Puro y sin dependencias para poder probarlo: de esto depende que un dato
// clínico no acabe en un servicio de terceros.

/**
 * Clasifica el error del proveedor SIN reenviar su contenido.
 *
 * El cuerpo de un error de OpenAI puede citar el prompt, y el prompt lleva las
 * directivas de salud de la persona. Lo que necesita quien diagnostica es la
 * CATEGORÍA, no el texto: con esto se distingue una cuota agotada de un
 * modelo caído sin que un dato clínico acabe en un servicio de terceros.
 *
 * Nota deliberada: solo se buscan códigos conocidos y se devuelve una etiqueta
 * fija. Nunca se devuelve un fragmento del cuerpo, ni siquiera "por si acaso".
 */
export function codigoDeError(cuerpo: string): string {
  const c = cuerpo.toLowerCase();
  if (c.includes('rate_limit') || c.includes('429')) return 'rate_limit';
  if (c.includes('insufficient_quota') || c.includes('quota')) return 'sin_cuota';
  if (c.includes('content_policy') || c.includes('content_filter')) return 'politica_de_contenido';
  if (c.includes('context_length') || c.includes('too many tokens')) return 'contexto_demasiado_largo';
  if (c.includes('model_not_found') || c.includes('does not exist')) return 'modelo_inexistente';
  if (c.includes('invalid_api_key') || c.includes('unauthorized')) return 'credencial_invalida';
  if (c.includes('timeout') || c.includes('deadline')) return 'timeout_proveedor';
  if (c.includes('overloaded') || c.includes('server_error')) return 'proveedor_saturado';
  return cuerpo.trim() ? 'sin_clasificar' : 'cuerpo_vacio';
}
