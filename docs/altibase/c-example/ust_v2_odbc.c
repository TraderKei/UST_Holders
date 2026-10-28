/* Reference ODBC adapter. Compile with the company's Altibase driver headers
 * and libraries. Test DATE conversion and diagnostics on that exact version.
 * No connection string, authentication or private server framework is assumed.
 */
#include "ust_v2_odbc.h"
#include <stdio.h>
#include <string.h>

int ust_v2_odbc_query(void *connection,const char *sql,const char *dataset,
                       UstRow on_row,void *user) {
    SQLHDBC dbc=(SQLHDBC)connection;
    SQLHSTMT stmt=SQL_NULL_HSTMT; SQLRETURN rc; SQLSMALLINT n=0,types[16];
    SQLLEN param_len=SQL_NTS; int ok=0,i;
    char storage[16][4096]; const char *cells[16];
    if(SQLAllocHandle(SQL_HANDLE_STMT,dbc,&stmt)!=SQL_SUCCESS) return 0;
    if(SQLPrepare(stmt,(SQLCHAR *)sql,SQL_NTS)!=SQL_SUCCESS) goto done;
    if(dataset && SQLBindParameter(stmt,1,SQL_PARAM_INPUT,SQL_C_CHAR,
          SQL_VARCHAR,36,0,(SQLPOINTER)dataset,37,&param_len)!=SQL_SUCCESS) goto done;
    if(SQLExecute(stmt)!=SQL_SUCCESS) goto done;
    if(SQLNumResultCols(stmt,&n)!=SQL_SUCCESS || n<1 || n>16) goto done;
    for(i=0;i<n;i++) {
        SQLCHAR name[128]; SQLSMALLINT name_len,scale,nullable;
        SQLULEN size;
        if(SQLDescribeCol(stmt,(SQLUSMALLINT)(i+1),name,sizeof(name),&name_len,
              &types[i],&size,&scale,&nullable)!=SQL_SUCCESS) goto done;
    }
    while((rc=SQLFetch(stmt))!=SQL_NO_DATA) {
        if(rc!=SQL_SUCCESS) goto done;
        for(i=0;i<n;i++) {
            SQLLEN indicator=0; cells[i]=storage[i]; storage[i][0]='\0';
            if(types[i]==SQL_TYPE_TIMESTAMP || types[i]==SQL_TIMESTAMP ||
               types[i]==SQL_TYPE_DATE || types[i]==SQL_DATE) {
                SQL_TIMESTAMP_STRUCT ts;
                memset(&ts,0,sizeof(ts));
                rc=SQLGetData(stmt,(SQLUSMALLINT)(i+1),SQL_C_TYPE_TIMESTAMP,
                              &ts,sizeof(ts),&indicator);
                if(rc!=SQL_SUCCESS) goto done;
                if(indicator==SQL_NULL_DATA) {cells[i]=NULL;continue;}
                if(ts.year<1 || ts.year>9999 || ts.month<1 || ts.month>12 ||
                   ts.day<1 || ts.day>31 || ts.hour>23 || ts.minute>59 || ts.second>59) goto done;
                /* UTC is an ingestion contract, not a driver timezone feature.
                 * Never append Z to a value stored in local server time.
                 */
                snprintf(storage[i],sizeof(storage[i]),"%04d-%02u-%02uT%02u:%02u:%02uZ",
                   (int)ts.year,(unsigned)ts.month,(unsigned)ts.day,
                   (unsigned)ts.hour,(unsigned)ts.minute,(unsigned)ts.second);
                if(ts.fraction) {
                    char fraction[10]; size_t digits;
                    if(ts.fraction>999999999U) goto done;
                    snprintf(fraction,sizeof(fraction),"%09u",(unsigned)ts.fraction);
                    digits=strlen(fraction);
                    while(digits && fraction[digits-1]=='0') fraction[--digits]='\0';
                    snprintf(storage[i]+19,sizeof(storage[i])-19,".%sZ",fraction);
                }
            } else {
                rc=SQLGetData(stmt,(SQLUSMALLINT)(i+1),SQL_C_CHAR,
                              storage[i],sizeof(storage[i]),&indicator);
                /* SUCCESS_WITH_INFO includes truncation and conversion warnings.
                 * Reject warnings here; adapt with reviewed diagnostics if needed.
                 * These are per-cell buffers, NOT a 4096-byte response limit.
                 */
                if(rc!=SQL_SUCCESS) goto done;
                if(indicator==SQL_NULL_DATA) {cells[i]=NULL;continue;}
                if(indicator<0 || (size_t)indicator>=sizeof(storage[i])) goto done;
                storage[i][(size_t)indicator]='\0';
            }
        }
        if(!on_row(user,n,cells)) goto done;
    }
    ok=1;
done:
    /* Company adapter: collect sanitized SQLGetDiagRec diagnostics BEFORE
     * releasing stmt on failure. Never log the connection string/password.
     */
    SQLFreeHandle(SQL_HANDLE_STMT,stmt);
    return ok;
}
int ust_v2_handle_request(SQLHDBC dbc,UstSend send,void *ctx) {
    UstReader reader; char *body=NULL,error[64]; size_t length=0; int sent;
    static const char failure[]="{\"error\":\"UST_DATA_UNAVAILABLE\"}";
    if(!send) return 0;
    reader.db=(void *)dbc; reader.query=ust_v2_odbc_query;
    if(!ust_v2_build(&reader,&body,&length,error,sizeof(error)))
        return send(ctx,503,"application/json; charset=utf-8","private, no-store",
                    failure,sizeof(failure)-1);
    /* Authentication/authorization runs in the company handler BEFORE this.
     * Content-Length is length BYTES, not the character count.
     * Do not emit status 200 or any body bytes until the JSON is complete.
     */
    sent=send(ctx,200,"application/json; charset=utf-8","private, no-store",body,length);
    ust_v2_free(body);
    return sent; /* If transmission fails, abort; never append a second response. */
}
