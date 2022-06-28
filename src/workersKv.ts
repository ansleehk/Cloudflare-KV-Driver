/** Local interfaces */
import { FetchInterfaces } from './fetch.js'
import { CloudflareResponseInterfaces } from './interfaces/cfResponse.js'

/** Local Modules */
import { CfHttpFetch } from './fetch.js'
import { CustomConsole, CustomError } from './util.js'

/** Downloaded Modules */
import { serializeError } from 'serialize-error'

export namespace WorkersKvInterfaces {
    export interface bridgeCommand {
        commandType: "CRUD" | "namespace" | "other",
        command: string,
        input: {
            relativePathParam: { [key: string]: string } | null,
            data: { [key: string]: any } | null,
            urlParam: { [key: string]: any } | null
        }
    }
}

export class WorkersKv {
    private cfAuth: {
        accountId: string,
        globalApiKey: string,
        accountEmail: string
    }
    private extensionArg: Array<Function>
    /**
     * @constructor
     * @see https://api.cloudflare.com/#getting-started-requests
     * @param {string} accountId The ID of the Cloudflare account
     * @param {string} apiToken The Api token that has the read and write access to the KV service
     * @param {Array[Function]} extensionArg The extensional functions that want to be executed after the database operation has been being performed
     * @example
     * const kvMonitor = new WorkersKvMonitor()
     * const workersKv = new WorkersKv(process.env["CF_EMAIL"], process.env["CF_ACCOUNT_ID"], process.env["CF_GLOBAL_API_KEY"], kvMonitor.dbListener.bind(kvMonitor))
     */
    constructor(
        accountEmail: string,
        accountId: string,
        globalApiKey: string,
        ...extensionArg: Array<Function>
    ) {
        if (accountId === undefined || globalApiKey === undefined || accountEmail == undefined) {
            throw new Error("Account Id, Global Api Key and Account Email must not be undefined")
        }

        this.cfAuth = {
            accountId: accountId,
            globalApiKey: globalApiKey,
            accountEmail: accountEmail
        }
        this.extensionArg = extensionArg;
    }
    /**
     * @function bridge
     * @async
     * @private
     * @description Handles the database operation that wants to be performed. It conveys the database operation request to the fetch function, receives the response from the fetch function, and send the whole database operation information to the function handler for extension purpose.
     * @param {Object} command The requested database operation
     * @param {Object} http The http request for the database operation
     * @returns {Promise}
     */
    protected async bridge(
        command: WorkersKvInterfaces.bridgeCommand,
        http: FetchInterfaces.httpFetchOptions,
        validateCfResponseMethod: "string" | "full" | "withoutResult" = "full"

    ): Promise<FetchInterfaces.ownFetchResponse> {
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
            }, validateCfResponseMethod).fetch()

            this.funcArgHandlers(true, command, cfFetch, null)

            return cfFetch;

        } catch (err) {
            this.funcArgHandlers(false, command, null, serializeError(err))
            throw err;
        }

    }
    /**
     * @function funcArgHandlers
     * @description It sends the database operation information to the function placed in the extensionArg of the class constructor
     * @param processSuccess Indicates whether the database operation has been performed successfully
     * @param command The requested database operation
     * @param cfFetch The response from Cloudflare on the database operation
     * @param errDetail The error detail of the database operation
     */
    protected funcArgHandlers(processSuccess: boolean,
        command: WorkersKvInterfaces.bridgeCommand,
        cfFetchRes: FetchInterfaces.fetchResponse | null = null,
        errDetail: { [key: string]: any } | null = null) {

        for (const func of this.extensionArg) {
            func(processSuccess, command, cfFetchRes, errDetail);
        }
    }
    /**
     * @function genReturnFromCfRes
     * @description Parsing and returning the Cloudflare response. Throw error when the database operation failed.
     * @param {string} method Returning part of the Cloudflare response
     */
    private genReturnFromCfRes(method: "boolean" | "fullResult" | "string", req: FetchInterfaces.ownFetchResponse, command: string){
        if (!req.isCfReqSuccess) {
            throw new CustomError(`Failed to ${command}`, "", req.cfRes["errors"])
        }
        switch (method){
            case "boolean":
                return req.isCfReqSuccess
            case "fullResult":
                return req.cfRes["result"]
            case "string":
                return req.cfRes
        }
    }

    /**
     * @function listNamespaces
     * @public
     * @see https://api.cloudflare.com/#workers-kv-namespace-list-namespaces
     * @param urlParam The parameters that are in the URL
     * @param urlParam.page Page number of paginated results
     * @param urlParam.perPage Maximum number of results per page
     * @param urlParam.order Field to order results by
     * @param urlParam.direction Direction to order namespaces
     */
    public async listNamespaces(
        urlParam?: {
            page?: number,
            per_page?: number,
            order?: "id" | "title",
            direction?: "asc" | "desc"
        }
    ): Promise<Array<CloudflareResponseInterfaces.listNamespaces>> {
        const reqData = urlParam || {};

        const command: WorkersKvInterfaces.bridgeCommand = {
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
     * @function createNamespace
     * @description Creates a namespace under the given title. A 400 is returned if the account already owns a namespace with this title. A namespace must be explicitly deleted to be replaced.
     * @public
     * @see https://api.cloudflare.com/#workers-kv-namespace-create-a-namespace
     * @param data The data that will send to Cloudflare
     * @param data.title A human-readable string name for a Namespace.
     */
    public async createNamespace(
        data: {
            title: string
        }
    ): Promise<CloudflareResponseInterfaces.createNamespace> {

        const command: WorkersKvInterfaces.bridgeCommand = {
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
     * @public
     * @async
     * @function removeNamespace
     * @description Deletes the namespace corresponding to the given ID.
     * @see https://api.cloudflare.com/#workers-kv-namespace-remove-a-namespace
     * @param relativePathParam The parameters in the relative path
     * @param relativePathParam.namespaceId The namespace identifier
     */
    public async removeNamespace(
        relativePathParam: {
            namespaceId: string
        }
    ): Promise<boolean> {
        const command: WorkersKvInterfaces.bridgeCommand = {
            commandType: "namespace",
            command: "Remove a namespace",
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
                path: `namespaces/${relativePathParam.namespaceId}`,
                params: null,
                body: null,
                contentType: "none"
            },
            "withoutResult"
        )
        return this.genReturnFromCfRes("boolean", req, command.command)
    }
    /**
     * @public
     * @async
     * @function renameNamespace
     * @description - Modifies a namespace's title.
     * @see https://api.cloudflare.com/#workers-kv-namespace-rename-a-namespace
     * @param relativePathParam The parameters in the relative path
     * @param relativePathParam.namespaceId - The namespace identifier
     * @param data - The data that will send to Cloudflare
     * @param data.title - A human-readable string name for a Namespace.
     */
    public async renameNamespace(
        relativePathParam: {
            namespaceId: string
        },
        data: {
            title: string
        }
    ): Promise<boolean> {
        const command: WorkersKvInterfaces.bridgeCommand = {
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
     * @public
     * @async
     * @function listNamespaceKeys
     * @see https://api.cloudflare.com/#workers-kv-namespace-list-a-namespace-s-keys
     * @param relativePathParam The parameters in the relative path
     * @param relativePathParam.namespaceId The namespace identifier
     * @param urlParam The parameters at the end of URL
     * @param urlParam.limit The number of keys to return. The cursor attribute may be used to iterate over the next batch of keys if there are more than the limit.
     * @param urlParam.cursor Opaque token indicating the position from which to continue when requesting the next set of records if the amount of list results was limited by the limit parameter. A valid value for the cursor can be obtained from the cursors object in the result_info structure.
     * @param urlParam.prefix A string prefix used to filter down which keys will be returned. Exact matches and any key names that begin with the prefix will be returned.
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
    ): Promise<CloudflareResponseInterfaces.listNamespaceKeys> {

        const reqData = urlParam || {};

        const command: WorkersKvInterfaces.bridgeCommand = {
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
        const response = {result: req.cfRes["result"], result_info: req.cfRes["result_info"]}

        if (req.isCfReqSuccess) {
            return response;
        } else {
            throw new CustomError(`Failed to ${command.command}`, "", req.cfRes["errors"])
        }

    }
    /**
     * @public
     * @async
     * @function readKeyValuePair
     * @see https://api.cloudflare.com/#workers-kv-namespace-read-key-value-pair
     * @param relativePathParam The parameters in the relative path
     * @param relativePathParam.namespaceId The namespace identifier
     * @param relativePathParam.keyName The name of the key
     */
    public async readKeyValuePair(
        relativePathParam: {
            namespaceId: string,
            keyName: string
        }
    ):Promise<string> {
        const command: WorkersKvInterfaces.bridgeCommand = {
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
     * @public
     * @async
     * @function readKeyMeta
     * @description Returns the metadata associated with the given key in the given namespace. Use URL-encoding to use special characters (e.g. :, !, %) in the key name.
     * @see https://api.cloudflare.com/#workers-kv-namespace-read-the-metadata-for-a-key
     * @param relativePathParam The parameters in the relative path
     * @param relativePathParam.namespaceId The namespace identifier
     * @param relativePathParam.keyName The name of the key
     */
    public async readKeyMeta(
        relativePathParam: {
            namespaceId: string,
            keyName: string
        }
    ) {
        const command: WorkersKvInterfaces.bridgeCommand = {
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
     * @public
     * @async
     * @function writeKeyValuePair
     * @description Write a value identified by a key. Use URL-encoding to use special characters (e.g. :, !, %) in the key name. Body should be the value to be stored. Existing values and expirations will be overwritten. If neither expiration nor expiration_ttl is specified, the key-value pair will never expire. If both are set, expiration_ttl is used and expiration is ignored.
     * @see https://api.cloudflare.com/#workers-kv-namespace-write-key-value-pair
     * @param {Object} relativePathParam - The parameters in the relative path
     * @param {string} relativePathParam.namespaceId - The namespace identifier
     * @param {string} relativePathParam.keyName - The name of the key
     * @param {Object} urlParam - The parameters at the end of URL
     * @param {number} urlParam.expiration
     * @param {number} urlParam.expiration_ttl
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

        const command: WorkersKvInterfaces.bridgeCommand = {
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
     * @public
     * @async
     * @function writeKeyValuePairMeta
     * @description Write a value identified by a key. Use URL-encoding to use special characters (e.g. :, !, %) in the key name. Body should be the value to be stored along with json metadata to be associated with the key/value pair. Existing values, expirations and metadata will be overwritten. If neither expiration nor expiration_ttl is specified, the key-value pair will never expire. If both are set, expiration_ttl is used and expiration is ignored.
     * @see https://api.cloudflare.com/#workers-kv-namespace-write-key-value-pair-with-metadata
     * @param {object} relativePathParam - The parameters in the relative path
     * @param {string} relativePathParam.namespaceId - The namespace identifier
     * @param {string} relativePathParam.keyName - The name of the key
     * @param {object} data - The data that will send to Cloudflare
     * @param {string} data.value - A byte sequence to be stored, up to 10 MB in length.
     * @param {object} data.metadata - Arbitrary JSON to be associated with a key/value pair
     * @param {number} data.expiration
     * @param {number} data.expiration_ttl
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

        const command: WorkersKvInterfaces.bridgeCommand = {
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
     * @public
     * @async
     * @function writeMultipleKeyValuePairs
     * @description Write multiple keys and values at once. Body should be an array of up to 10,000 key-value pairs to be stored, along with optional expiration information. Existing values and expirations will be overwritten. If neither expiration nor expiration_ttl is specified, the key-value pair will never expire. If both are set, expiration_ttl is used and expiration is ignored. The entire request size must be 100 megabytes or less.
     * @see https://api.cloudflare.com/#workers-kv-namespace-write-multiple-key-value-pairs
     * @param {object} relativePathParam - The parameters in the relative path
     * @param {string} relativePathParam.namespaceId - The namespace identifier
     * @param {object} data - The data that will send to Cloudflare
     * @param {string} data.key - A key's name. The name may be at most 512 bytes. All printable, non-whitespace characters are valid.
     * @param {string} data.value - A UTF-8 encoded string to be stored, up to 10 MB in length.
     * @param {number} data.expiration - The time, measured in number of seconds since the UNIX epoch, at which the key should expire.
     * @param {number} data.expiration_ttl - The number of seconds for which the key should be visible before it expires. At least 60.
     * @param {object} data.metadata - Arbitrary JSON that is associated with a key
     * @param {boolean} data.base64 - Whether or not the server should base64 decode the value before storing it. Useful for writing values that wouldn't otherwise be valid JSON strings, such as images.
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
        const customLog = new CustomConsole();


        const command: WorkersKvInterfaces.bridgeCommand = {
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
     * @public
     * @async
     * @function deleteKeyValuePair
     * @description Remove a KV pair from the Namespace. Use URL-encoding to use special characters (e.g. :, !, %) in the key name.
     * @see https://api.cloudflare.com/#workers-kv-namespace-delete-key-value-pair
     * @param {object} relativePathParam - The parameters in the relative path
     * @param {string} relativePathParam.namespaceId - The namespace identifier
     * @param {string} relativePathParam.keyName - The name of the key
     */
    public async deleteKeyValuePair(
        relativePathParam: {
            namespaceId: string,
            keyName: string
        }
    ): Promise<boolean> {

        const command: WorkersKvInterfaces.bridgeCommand = {
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
     * @public
     * @async
     * @function deleteMultipleKeyValuePairs
     * @description Remove multiple KV pairs from the Namespace. Body should be an array of up to 10,000 keys to be removed.
     * @see https://api.cloudflare.com/#workers-kv-namespace-delete-multiple-key-value-pairs
     * @param {object} relativePathParam - The parameters in the relative path
     * @param {string} relativePathParam.namespaceId - The namespace identifier
     * @param {object} data - The data that will send to Cloudflare
     * @param {Array} data.keyName - The name of the key
     */
    public async deleteMultipleKeyValuePairs(
        relativePathParam: {
            namespaceId: string
        },
        data: {
            keyName: Array<string>
        }
    ): Promise<boolean> {

        const command: WorkersKvInterfaces.bridgeCommand = {
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
    read = this.readKeyValuePair
    write = this.writeKeyValuePair
    delete = this.deleteKeyValuePair
}