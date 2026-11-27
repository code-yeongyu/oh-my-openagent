### Fixed

- thread client: refuse a dial whose key record is missing, or whose host does not authenticate while a key record names its endpoint. A key record under the key root that cannot be read refuses an unauthenticated dial and names the file to remove. An endpoint that no key record names is served without authentication. The refusal's next step stays the generic one; the key-record remedy follows in [#15192](https://github.com/code-yeongyu/oh-my-openagent/issues/15192).
