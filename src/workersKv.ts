/** Local interfaces */
import { FetchInterfaces } from './interfaces/fetch.js'
import { CloudflareResponseInterfaces } from './interfaces/cfResponse.js'
import { WorkersKvInterfaces } from './interfaces/kv.js'

/** Local Modules */
import { CfHttpFetch } from './fetch.js'
import { CustomConsole, WorkersKvError } from './util.js'

/** Downloaded Modules */
import { serializeError } from 'serialize-error'

/**
 * Perform Kv database operations
 * @class
 */
export class WorkersKv {
    private cfAuth: {
        accountId: string,
        globalApiKey: string,
        accountEmail: string
    }
    private extensionArg: Array<Function>
    private isValidateCfResponse: boolean
    /**
     * @constructor
     * @see {@link https://api.cloudflare.com/#getting-started-requests}
     * @param {string} accountEmail An email of the Cloudflare account
     * @param {string} accountId An Id of the Cloudflare account
     * @param {string} apiToken An Global API key generated by Cloudflare
     * @see {@link https://dash.cloudflare.com/profile/api-tokens} to view the Global API key in your Cloudflare account.
     * @param {boolean} [isValidateCfResponse = true] True if want to validate the response sent from Cloudflare, otherwise false.
     * @param {Array[Function]} [extensionArg] Extensional function that is wanted to be executed after the database operation is performed
     * @example
     * const kvMonitor = new WorkersKvMonitor();
     * const workersKv = new WorkersKv(process.env["CF_EMAIL"], process.env["CF_ACCOUNT_ID"], process.env["CF_GLOBAL_API_KEY"], true, kvMonitor.dbListener.bind(kvMonitor));
     */
    constructor(
        accountEmail: string,
        accountId: string,
        globalApiKey: string,
        isValidateCfResponse: boolean = true,
        ...extensionArg: Array<Function>
    ) {
        if (accountId === undefined || globalApiKey === undefined || accountEmail == undefined) {
            throw new WorkersKvError("Missing Critical Authentication Info", "Account Id, Global Api Key and Account Email must not be undefined", null)
        }

        this.cfAuth = {
            accountId: accountId,
            globalApiKey: globalApiKey,
            accountEmail: accountEmail
        }
        this.extensionArg = extensionArg;
        this.isValidateCfResponse = isValidateCfResponse;
    }
    /**
     * Handling a database operation that wants to be performed. 
     * It conveys a database operation request to the fetch function, receives a response from the fetch function, and send the whole database operation information to the funcArgHandlers for extensional purpose.
     * @function bridge
     * @async
     * @private
     * @param {Object} command Information about the requested database operation
     * @param {Object} http Data related to the db operation for the HTTP request
     * @returns {Promise} A full information about the HTTP request, database operation perform status, and other Cloudflare responses
     */
    protected async bridge(
        command: WorkersKvInterfaces.BridgeCommand,
        http: FetchInterfaces.httpFetchOptions,
        validateCfResponseMethod: "string" | "full" | "withoutResult" = "full"

    ): Promise<FetchInterfaces.OwnFetchResponse> {
        try {
            const cfFetch = await new CfHttpFetch({
                accountId: this.cfAuth.accountId,
                globalApiKey: this.cfAuth.globalApiKey,
                accountEmail: this.cfAuth.accountEmail
            }, {
                method: http.method,
                path: http.path,
                params: http.params,
                body: http.body,
                contentType: http.contentType
            }, this.isValidateCfResponse && validateCfResponseMethod).fetch()

            this.funcArgHandlers(
                cfFetch.isCfReqSuccess,
                command, 
                cfFetch, 
                cfFetch.cfError)

            return cfFetch;

        } catch (err) {
            this.funcArgHandlers(false, command, null, serializeError(err));
            throw err;
        }

    }
    /**
     * Sending a database operation information to the function placed in the extensionArg in the class constructor
     * @function funcArgHandlers
     * @param {(boolean | null)} processSuccess True if the database operation is completed successfully, false otherwise. Null if it is uncertain that whether the operation is completed successfully or not.
     * @param {object} command Information about the requested database operation
     * @param {object} cfFetchRes A full information about the HTTP request, database operation perform status, and other Cloudflare responses
     * @param {object} errDetail The error detail of the database operation
     */
    protected funcArgHandlers(
        processSuccess: boolean | null,
        command: WorkersKvInterfaces.BridgeCommand,
        cfFetchRes: FetchInterfaces.OwnFetchResponse | null = null,
        errDetail: { [key: string]: any } | null = null): void {

        for (const func of this.extensionArg) {
            func(processSuccess, command, cfFetchRes, errDetail);
        }

    }
    /**
     * Parsing and returning the Cloudflare response.
     * @function genReturnFromCfRes
     * @param {string} method A desired Cloudflare response format
     * @param {object} req A full information about the HTTP request, database operation perform status, and other Cloudflare responses
     * @param {string} command A short description of the performed operation.
     * @return A Cloudflare result that is shorten and pretty formatted.
     * @throws {WorkersKvError} The Kv operation request is failed.
     */
    private genReturnFromCfRes(method: "boolean" | "fullResult" | "string", 
                                req: FetchInterfaces.OwnFetchResponse, 
                                command: string){
        const REF_ERR_MSG = "Please refer to the error message from Cloudflare."
        const NULL_ERR_MSG = "Cloudflare did not return the error information."
        const UNCERTAIN_ERR_MSG = `It is uncertain that whether the request \'${command}\' has been performed successfully.`

        if (req.isCfReqSuccess === false) {
            if (req.cfError){
                throw new WorkersKvError(`Failed to ${command}`, REF_ERR_MSG , req.cfError)
            } else {
                throw new WorkersKvError(`Failed to ${command}`, NULL_ERR_MSG, req.http)
            }
        } else if (req.isCfReqSuccess === null){
            if (req.cfError){
                throw new WorkersKvError(UNCERTAIN_ERR_MSG, REF_ERR_MSG, req.cfError)
            } else {
                throw new WorkersKvError(UNCERTAIN_ERR_MSG, NULL_ERR_MSG, req.http)
            }
        }
        switch (method){
            case "boolean":
                return req.isCfReqSuccess
            case "fullResult":
                return (req.cfRes as CloudflareResponseInterfaces.GeneralResponse | CloudflareResponseInterfaces.ResultInfoResponse)["result"] 
            case "string":
                return req.cfRes
        }
    }

    /**
     * Returns the namespaces owned by an account
     * @function listNamespaces
     * @public
     * @see {@link https://api.cloudflare.com/#workers-kv-namespace-list-namespaces}
     * @param {object} [urlParam] The parameters that are in the URL
     * @param {number} [urlParam.page] Page number of paginated results
     * @param {number} [urlParam.perPage] Maximum number of results per page
     * @param {string} [urlParam.order] Field to order results by
     * @param {string} [urlParam.direction] Direction to order namespaces
     * @returns {Promise<object>} Information about the new namespace.
     * @throws {WorkersKvError} The Kv operation request is failed.
     */
    public async listNamespaces(
        urlParam?: {
            page?: number,
            per_page?: number,
            order?: "id" | "title",
            direction?: "asc" | "desc"
        }
    ): Promise<Array<CloudflareResponseInterfaces.NamespaceRes>> {
        const reqData = urlParam || {};

        const command: WorkersKvInterfaces.BridgeCommand = {
            commandType: "namespace",
            command: "List Namespaces",
            input: {
                relativePathParam: null,
                urlParam: reqData,
                data: null
            }
        }

        const req = await this.bridge(
            command,
            {
                method: "GET",
                path: "namespaces",
                params: Object.keys(reqData).length == 0 ? null : reqData,
                body: null,
                contentType: "none"
            }
        )

        return this.genReturnFromCfRes("fullResult", req, command.command)

    }
    /**
     * Creates a namespace under the given title. A 400 is returned if the account already owns a namespace with this title. A namespace must be explicitly deleted to be replaced.
     * @function createNamespace
     * @public
     * @see {@link https://api.cloudflare.com/#workers-kv-namespace-create-a-namespace}
     * @param {object} data Data for the HTTP body that will send to Cloudflare
     * @param {string} data.title A human-readable string name for a Namespace.
     * @returns {Promise<object>} Information about the new namespace.
     * @throws {WorkersKvError} The Kv operation request is failed.
     */
    public async createNamespace(
        data: {
            title: string
        }
    ): Promise<CloudflareResponseInterfaces.NamespaceRes> {

        const command: WorkersKvInterfaces.BridgeCommand = {
            commandType: "namespace",
            command: "Create a namespace",
            input: {
                relativePathParam: null,
                urlParam: null,
                data: data
            }
        }

        const req = await this.bridge(
            command,
            {
                method: "POST",
                path: "namespaces",
                params: null,
                body: data,
                contentType: "json"
            }
        )
        return this.genReturnFromCfRes("fullResult", req, command.command)
    }
    /**
     * Deletes the namespace corresponding to the given ID.
     * @public
     * @async
     * @function removeNamespace
     * @see {@link https://api.cloudflare.com/#workers-kv-namespace-remove-a-namespace}
     * @param {object} relativePathParam Parameters in the relative path
     * @param {string} relativePathParam.namespaceId The namespace identifier
     * @returns {boolean} True if the namespace is successfully removed, false otherwise.
     * @throws {WorkersKvError} The Kv operation request is failed.
     */
    public async removeNamespace(
        relativePathParam: {
            namespaceId: string
        }
    ): Promise<boolean> {
        const command: WorkersKvInterfaces.BridgeCommand = {
            commandType: "namespace",
            command: "Remove a namespace",
            input: {
                relativePathParam: relativePathParam,
                urlParam: null,
                data: null
            }
        }

        let req: FetchInterfaces.OwnFetchResponse;

        req = await this.bridge(
            command,
            {
                method: "DELETE",
                path: `namespaces/${relativePathParam.namespaceId}`,
                params: null,
                body: null,
                contentType: "none"
            },
            "withoutResult"
        )

        return this.genReturnFromCfRes("boolean", req!, command.command)
    }
    /**
     * Modifies a namespace's title.
     * @public
     * @async
     * @function renameNamespace
     * @see {@link https://api.cloudflare.com/#workers-kv-namespace-rename-a-namespace}
     * @param {object} relativePathParam Parameters in the relative path
     * @param {string} relativePathParam.namespaceId The namespace identifier
     * @param {object} data Data for the HTTP body that will send to Cloudflare
     * @param {string} data.title A human-readable string name for a Namespace.
     * @returns {boolean} True if the namespace is successfully renamed, false otherwise.
     * @throws {WorkersKvError} The Kv operation request is failed.
     */
    public async renameNamespace(
        relativePathParam: {
            namespaceId: string
        },
        data: {
            title: string
        }
    ): Promise<boolean> {
        const command: WorkersKvInterfaces.BridgeCommand = {
            commandType: "namespace",
            command: "Rename a namespace",
            input: {
                relativePathParam: relativePathParam,
                urlParam: null,
                data: data
            }
        }
        const req = await this.bridge(
            command,
            {
                method: "PUT",
                path: `namespaces/${relativePathParam.namespaceId}`,
                params: null,
                body: data,
                contentType: "json"
            },
            "withoutResult"
        )

        return this.genReturnFromCfRes("boolean", req, command.command)

    }
    /**
     * Lists a namespace's keys.
     * @public
     * @async
     * @function listNamespaceKeys
     * @see {@link https://api.cloudflare.com/#workers-kv-namespace-list-a-namespace-s-keys}
     * @param {object} relativePathParam Parameters in the relative path
     * @param {string} relativePathParam.namespaceId The namespace identifier
     * @param {object} [urlParam] The parameters at the end of URL
     * @param {number} [urlParam.limit] The number of keys to return. The cursor attribute may be used to iterate over the next batch of keys if there are more than the limit.
     * @param {string} [urlParam.cursor] Opaque token indicating the position from which to continue when requesting the next set of records if the amount of list results was limited by the limit parameter. A valid value for the cursor can be obtained from the cursors object in the result_info structure.
     * @param {string} [urlParam.prefix] A string prefix used to filter down which keys will be returned. Exact matches and any key names that begin with the prefix will be returned.
     * @return {Promise<object>} A list of namespace's key as well as the page and cursor information.
     * @throws {WorkersKvError} The Kv operation request is failed.
     */
    public async listNamespaceKeys(
        relativePathParam: {
            namespaceId: string
        },
        urlParam?: {
            limit?: number,
            cursor?: string,
            prefix?: string
        }
    ): Promise<CloudflareResponseInterfaces.NamespaceKeysRes> {

        const reqData = urlParam || {};

        const command: WorkersKvInterfaces.BridgeCommand = {
            commandType: "namespace",
            command: "Lists a namespace's keys.",
            input: {
                relativePathParam: relativePathParam,
                urlParam: reqData,
                data: null
            }
        }
        const req = await this.bridge(
            command,
            {
                method: "GET",
                path: `namespaces/${relativePathParam.namespaceId}/keys`,
                params: reqData,
                body: null,
                contentType: "none"
            }
        )
        req.cfRes = req.cfRes as CloudflareResponseInterfaces.ResultInfoResponse

        const response = {result: req.cfRes["result"], 
                            result_info: req.cfRes["result_info"]}

        if (req.isCfReqSuccess) {
            return response;
        } else {
            throw new WorkersKvError(`Failed to ${command.command}`, "", req.cfRes["errors"])
        }

    }
    /**
     * Returns the value associated with the given key in the given namespace. 
     * Use URL-encoding to use special characters (e.g. :, !, %) in the key name. 
     * If the KV-pair is set to expire at some point, the expiration time as measured in seconds since the UNIX epoch will be returned in the "Expiration" response header.
     * @public
     * @async
     * @function readKeyValuePair
     * @see {@link https://api.cloudflare.com/#workers-kv-namespace-read-key-value-pair}
     * @param {object} relativePathParam The parameters in the relative path
     * @param {string} relativePathParam.namespaceId The namespace identifier
     * @param {string} relativePathParam.keyName The name of the key
     * @returns {Promise<string>} The key value.
     * @throws {WorkersKvError} The Kv operation request is failed.
     */
    public async readKeyValuePair(
        relativePathParam: {
            namespaceId: string,
            keyName: string
        }
    ):Promise<string> {
        const command: WorkersKvInterfaces.BridgeCommand = {
            commandType: "CRUD",
            command: "Read key-value pair",
            input: {
                relativePathParam: relativePathParam,
                urlParam: null,
                data: null
            }
        }
        const req = await this.bridge(
            command,
            {
                method: "GET",
                path: `namespaces/${relativePathParam.namespaceId}/values/${relativePathParam.keyName}`,
                params: null,
                body: null,
                contentType: "none"
            },
            "string"
        )
        
        return this.genReturnFromCfRes("string", req, command.command)
    }
    /**
     * Returns the metadata associated with the given key in the given namespace. Use URL-encoding to use special characters (e.g. :, !, %) in the key name.
     * @public
     * @async
     * @function readKeyMeta
     * @see https://api.cloudflare.com/#workers-kv-namespace-read-the-metadata-for-a-key
     * @param {object} relativePathParam Parameters in the relative path
     * @param {string} relativePathParam.namespaceId The namespace identifier
     * @param {string} relativePathParam.keyName The name of the key
     * @returns {Promise<object>} An object containing the key and value of the metadata.
     * @throws {WorkersKvError} The Kv operation request is failed.
     */
    public async readKeyMeta(
        relativePathParam: {
            namespaceId: string,
            keyName: string
        }
    ) {
        const command: WorkersKvInterfaces.BridgeCommand = {
            commandType: "CRUD",
            command: "Read the metadata for a key",
            input: {
                relativePathParam: relativePathParam,
                urlParam: null,
                data: null
            }
        }
        const req = await this.bridge(
            command,
            {
                method: "GET",
                path: `namespaces/${relativePathParam.namespaceId}/metadata/${relativePathParam.keyName}`,
                params: null,
                body: null,
                contentType: "none"
            }
        )

        return this.genReturnFromCfRes("fullResult", req, command.command)
    }
    /**
     * Write a value identified by a key. 
     * Use URL-encoding to use special characters (e.g. :, !, %) in the key name. 
     * Body should be the value to be stored. Existing values and expirations will be overwritten. 
     * If neither expiration nor expiration_ttl is specified, the key-value pair will never expire. 
     * If both are set, expiration_ttl is used and expiration is ignored.
     * @public
     * @async
     * @function writeKeyValuePair
     * @see https://api.cloudflare.com/#workers-kv-namespace-write-key-value-pair
     * @param {Object} relativePathParam Parameters in the relative path
     * @param {string} relativePathParam.namespaceId The namespace identifier
     * @param {string} relativePathParam.keyName The name of the key
     * @param {string} value A UTF-8 encoded string to be stored, up to 10 MB in length.
     * @param {Object} [urlParam] The parameters at the end of URL
     * @param {number} [urlParam.expiration] The time, measured in number of seconds since the UNIX epoch, at which the key should expire.
     * @param {number} [urlParam.expiration_ttl] The number of seconds for which the key should be visible before it expires. At least 60.
     * @returns {Promise<boolean>} True if key is successfully modified or added, false otherwise.
     * @throws {WorkersKvError} The Kv operation request is failed.
     */
    public async writeKeyValuePair(
        relativePathParam: {
            namespaceId: string,
            keyName: string
        },
        value: string,
        urlParam?: {
            expiration?: number,
            expiration_ttl?: number
        }
    ): Promise<boolean> {
        const customLog = new CustomConsole();

        if (urlParam !== undefined && urlParam.expiration !== undefined && urlParam.expiration_ttl !== undefined)
            customLog.warning("Only expiration_ttl will be used",
                "Specify either expiration or expiration TTL. Do not specify both.",
                "According to Cloudflare, \"If both are set, expiration_ttl is used and expiration is ignored.\"")

        urlParam = urlParam || {};

        const command: WorkersKvInterfaces.BridgeCommand = {
            commandType: "CRUD",
            command: "Write key-value pair",
            input: {
                relativePathParam: relativePathParam,
                urlParam: urlParam,
                data: {value: value}
            }
        }
        const req = await this.bridge(
            command,
            {
                method: "PUT",
                path: `namespaces/${relativePathParam.namespaceId}/values/${relativePathParam.keyName}`,
                params: urlParam,
                body: value,
                contentType: "plainText"
            },
            "withoutResult"
        )
        
        return this.genReturnFromCfRes("boolean", req, command.command)

    }
    /**
     * Write a value identified by a key. Use URL-encoding to use special characters (e.g. :, !, %) in the key name. 
     * Body should be the value to be stored along with json metadata to be associated with the key/value pair.
     * Existing values, expirations and metadata will be overwritten.
     * If neither expiration nor expiration_ttl is specified, the key-value pair will never expire. 
     * If both are set, expiration_ttl is used and expiration is ignored.
     * @public
     * @async
     * @function writeKeyValuePairMeta
     * @see https://api.cloudflare.com/#workers-kv-namespace-write-key-value-pair-with-metadata
     * @param {object} relativePathParam The parameters in the relative path
     * @param {string} relativePathParam.namespaceId The namespace identifier
     * @param {string} relativePathParam.keyName The name of the key
     * @param {object} data The data that will send to Cloudflare
     * @param {string} data.value A byte sequence to be stored, up to 10 MB in length.
     * @param {object} data.metadata Arbitrary JSON to be associated with a key/value pair
     * @param {object} [urlParam] The parameters at the end of URL
     * @param {number} [urlParam.expiration] The time, measured in number of seconds since the UNIX epoch, at which the key should expire.
     * @param {number} [urlParam.expiration_ttl] The number of seconds for which the key should be visible before it expires. At least 60.
     * @returns {Promise<boolean>} True if key is successfully modified or added, false otherwise.
     * @throws {WorkersKvError} The Kv operation request is failed.
     */
    public async writeKeyValuePairMeta(
        relativePathParam: {
            namespaceId: string,
            keyName: string
        },
        data: {
            value: string,
            metadata: { [key: string]: any }
        },
        urlParam?: {
            expiration?: number,
            expiration_ttl?: number
        }
    ): Promise<boolean> {
        const customLog = new CustomConsole();

        if (urlParam!== undefined && urlParam.expiration !== undefined && urlParam.expiration_ttl !== undefined)
            customLog.warning("Only expiration_ttl will be used",
                "Specify either expiration or expiration TTL. Do not specify both.",
                "According to Cloudflare, \"If both are set, expiration_ttl is used and expiration is ignored.\"")

        const reqData = { value: data.value, metadata: JSON.stringify(data.metadata) }

        const command: WorkersKvInterfaces.BridgeCommand = {
            commandType: "CRUD",
            command: "Write key-value pair with metadata",
            input: {
                relativePathParam: relativePathParam,
                urlParam: urlParam || null,
                data: reqData
            }
        }

        const req = await this.bridge(
            command,
            {
                method: "PUT",
                path: `namespaces/${relativePathParam.namespaceId}/values/${relativePathParam.keyName}`,
                params: urlParam || null,
                body: reqData,
                contentType: "formData"
            },
            "withoutResult"
        )

        return this.genReturnFromCfRes("boolean", req, command.command)
    }
    /**
     * Write multiple keys and values at once. Body should be an array of up to 10,000 key-value pairs to be stored, along with optional expiration information. 
     * Existing values and expirations will be overwritten. If neither expiration nor expiration_ttl is specified, the key-value pair will never expire. 
     * If both are set, expiration_ttl is used and expiration is ignored. The entire request size must be 100 megabytes or less.
     * @public
     * @async
     * @function writeMultipleKeyValuePairs
     * @see https://api.cloudflare.com/#workers-kv-namespace-write-multiple-key-value-pairs
     * @param {object} relativePathParam The parameters in the relative path
     * @param {string} relativePathParam.namespaceId The namespace identifier
     * @param {object} data The data that will send to Cloudflare
     * @param {string} data.key A key's name. The name may be at most 512 bytes. All printable, non-whitespace characters are valid.
     * @param {string} data.value A UTF-8 encoded string to be stored, up to 10 MB in length.
     * @param {number} [data.expiration] The time, measured in number of seconds since the UNIX epoch, at which the key should expire.
     * @param {number} [data.expiration_ttl] The number of seconds for which the key should be visible before it expires. At least 60.
     * @param {object} [data.metadata] Arbitrary JSON that is associated with a key
     * @param {boolean} [data.base64] Whether or not the server should base64 decode the value before storing it. Useful for writing values that wouldn't otherwise be valid JSON strings, such as images.
     * @returns {Promise<boolean>} True if keys are successfully modified or added, false otherwise.
     * @throws {WorkersKvError} The Kv operation request is failed.
     */
    public async writeMultipleKeyValuePairs(
        relativePathParam: {
            namespaceId: string,
        },
        data: Array<{
            key: string,
            value: string
            expiration?: number,
            expiration_ttl?: number,
            metadata?: { [key: string]: any },
            base64?: boolean
        }>
    ): Promise<boolean>{
        const command: WorkersKvInterfaces.BridgeCommand = {
            commandType: "CRUD",
            command: "Write multiple key-value pairs",
            input: {
                relativePathParam: relativePathParam,
                urlParam: null,
                data: data
            }
        }
        const req = await this.bridge(
            command,
            {
                method: "PUT",
                path: `namespaces/${relativePathParam.namespaceId}/bulk`,
                params: null,
                body: data,
                contentType: "json"
            },
            "withoutResult"
        )

        return this.genReturnFromCfRes("boolean", req, command.command)

    }
    /**
     * Remove a KV pair from the Namespace. Use URL-encoding to use special characters (e.g. :, !, %) in the key name.
     * @public
     * @async
     * @function deleteKeyValuePair
     * @see https://api.cloudflare.com/#workers-kv-namespace-delete-key-value-pair
     * @param {object} relativePathParam The parameters in the relative path
     * @param {string} relativePathParam.namespaceId The namespace identifier
     * @param {string} relativePathParam.keyName The name of the key
     * @returns {Promise<boolean>} True if the key is successfully removed, false otherwise.
     * @throws {WorkersKvError} The Kv operation request is failed.
     */
    public async deleteKeyValuePair(
        relativePathParam: {
            namespaceId: string,
            keyName: string
        }
    ): Promise<boolean> {

        const command: WorkersKvInterfaces.BridgeCommand = {
            commandType: "CRUD",
            command: "Delete key-value pair",
            input: {
                relativePathParam: relativePathParam,
                urlParam: null,
                data: null
            }
        }
        const req = await this.bridge(
            command,
            {
                method: "DELETE",
                path: `namespaces/${relativePathParam.namespaceId}/values/${relativePathParam.keyName}`,
                params: null,
                body: null,
                contentType: "none"
            }
        )

        return this.genReturnFromCfRes("boolean", req, command.command)
    }
    /**
     * Remove multiple KV pairs from the Namespace. Body should be an array of up to 10,000 keys to be removed.
     * @public
     * @async
     * @function deleteMultipleKeyValuePairs
     * @see https://api.cloudflare.com/#workers-kv-namespace-delete-multiple-key-value-pairs
     * @param {object} relativePathParam The parameters in the relative path
     * @param {string} relativePathParam.namespaceId The namespace identifier
     * @param {object} data The data that will send to Cloudflare
     * @param {Array} data.keyName The name of the key
     * @returns {Promise<boolean>} True if keys are successfully removed, false otherwise.
     * @throws {WorkersKvError} The Kv operation request is failed.
     */
    public async deleteMultipleKeyValuePairs(
        relativePathParam: {
            namespaceId: string
        },
        data: {
            keyName: Array<string>
        }
    ): Promise<boolean> {

        const command: WorkersKvInterfaces.BridgeCommand = {
            commandType: "CRUD",
            command: "Delete multiple key-value pairs",
            input: {
                relativePathParam: relativePathParam,
                urlParam: null,
                data: data.keyName
            }
        }
        const req = await this.bridge(
            command,
            {
                method: "DELETE",
                path: `namespaces/${relativePathParam.namespaceId}/bulk`,
                params: null,
                body: data.keyName,
                contentType: "json"
            },
            "withoutResult"
        )
        return this.genReturnFromCfRes("boolean", req, command.command)
    }

    /**Functions' aliases */
    public read = this.readKeyValuePair
    public write = this.writeKeyValuePair
    public delete = this.deleteKeyValuePair
}
