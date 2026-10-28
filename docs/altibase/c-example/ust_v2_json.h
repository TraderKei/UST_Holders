#ifndef UST_V2_JSON_H
#define UST_V2_JSON_H
#include <stddef.h>

/* All non-NULL cells must be NUL-terminated UTF-8. Numeric cells are ASCII.
 * SQL NULL is a NULL pointer. Row memory remains valid during the callback.
 * Return 1 on complete success, 0 on DB, conversion or callback failure.
 * dataset_id is a bound parameter, never interpolated into SQL.
 */
typedef int (*UstRow)(void *user, int columns, const char *const *cells);
typedef int (*UstQuery)(void *db, const char *sql, const char *dataset_id,
                        UstRow on_row, void *user);
typedef struct { void *db; UstQuery query; } UstReader;

/* Build the entire body before sending headers. On failure *body == NULL.
 * One connection per request; no shared mutable request state.
 * Release successful output using ust_v2_free(), NOT an arbitrary allocator.
 * The error text is deliberately generic; log sanitized driver diagnostics
 * separately on the server, never send them or credentials to the browser.
 */
int ust_v2_build(const UstReader *reader, char **body, size_t *length,
                 char *error, size_t error_capacity);
void ust_v2_free(char *body);
#endif
