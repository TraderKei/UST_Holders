#ifndef UST_V2_ODBC_H
#define UST_V2_ODBC_H
#ifdef _WIN32
#include <windows.h>
#endif
#include <sql.h>
#include <sqlext.h>
#include "ust_v2_json.h"

/* dbc is an already connected Altibase ODBC handle owned by the company.
 * Configure the approved driver to return UTF-8 before calling this adapter.
 * send must synchronously consume/copy all bytes and return 1 on success.
 * A queued asynchronous send must retain its OWN copy of the body.
 */
typedef int (*UstSend)(void *ctx,int status,const char *content_type,
                       const char *cache_control,const char *body,size_t length);
int ust_v2_odbc_query(void *dbc,const char *sql,const char *dataset,
                       UstRow row,void *user);
int ust_v2_handle_request(SQLHDBC dbc,UstSend send,void *ctx);
#endif
