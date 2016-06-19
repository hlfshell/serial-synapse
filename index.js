"use strict"

class Synapse {
    
    constructor(opts){   
        if(!opts) opts = {};
             
        this._conn = opts.connection;
        
        this._commands = {};
        this._waitingResponse = {};
        
        this._updateHandlers = {};
        
        this.onClose = opts.onClose;
        this.onError = opts.onError;
        
        this._reconnectOnClose = opts._reconnectOnClose || false;
		
		this._reservedNames = [];
        
        if(this._conn) this._setListeners();
    }
    
    get connection(){
        return this._conn;
    }
    
    set connection(conn){
        this._conn = conn;
        this._setListeners();
    }
	
	addCommand(opts){
        var self = this;
        
        //Validators
        if(!opts) throw new Error("No options passed to setup a function");
        if(!opts.name) throw new Error("The 'name' attribute is required for for adding a new function");
        else if(!/^[a-z0-9]+$/i.test(opts.name)) throw new Error("The name must be compatible with a javascript function - only alphanumericCharacters")
        else if(opts.name[0] == "_") throw new Error("A function can not start with _, as that is reserved for internal functions for synapse-control");
        else if(self._reservedNames.indexOf(opts.name) != -1) throw new Error("The name " + opts.name + " is a reserved name and can not be used");
        
        if(!opts.returns) opts.returns = [];
        
		//Iterate over the already created react functions and make sure that none of them have the same identifier
        if(!opts.identifier || opts.identifier === 0) throw new Error("An identifier (an enum that tells the MCU which function you are executing) must be specified");
        else {
            Object.keys(self._commands).forEach(function(fncName){
               if(self._commands[fncName].identifier == opts.identifier) throw new Error("This fnc Identifier was already used by " + fncName); 
            });
        }
        
        //Two types of functions - silent (no response) and responsive
		if(opts.silent){
			opts.timeout = -1;
		} else {
			//Default no timeout
			if(!opts.timeout) opts.timeout = -1;
		}
        
        //Save the function information and options to this object
        self._commands[opts.name] = opts;
        
        //Create the invocation function on this object
        self[opts.name] = function(){ self._executeCommand(opts.name, arguments) };
	
		return self;
    }
	
	addUpdateHandler(opts){
        var self = this;
		
        if(!opts.name) throw new Error("The 'name' attribute is required for for adding an update handler");
        else if(!/^[a-z0-9]+$/i.test(opts.name)) throw new Error("The name must be compatible with a javascript function - only alphanumericCharacters")
        else if(opts.name[0] == "_") throw new Error("A function can not start with _, as that is reserved for internal functions for synapse-control");
        else if(self._reservedNames.indexOf(opts.name) != -1) throw new Error("The name " + opts.name + " is a reserved name and can not be used");
        
        if(!opts.then || typeof opts.then != "function") throw new Error("then must be a function");
		
		//Iterate over the already created update handlers and make sure that none of them have the same identifier
		if(!opts.identifier || opts.identifier === 0) throw new Error("An identifier (an enum that lets the MCU let synapse know which update function is replying) must be specified");
        else {
            Object.keys(self._updateHandlers).forEach(function(fncName){
               if(self._updateHandlers[opts.identifier]) throw new Error("This fnc Identifier was already used by " + fncName); 
            });
        }
		
		if(!opts.returns) opts.returns = [];
		
		self._updateHandlers[opts.identifier] = opts;
		
		return self;
    }
    
    //Helper function to allow easy programmatic function/handler attachment
    add(type, opts){
        var self = this;
                
        switch(type.toLowerCase()){
            case "command":
                return self.addCommand(opts);
            case "update":
                return self.addUpdateHandler(opts);
            default:
                throw new Error("Improper type - only 'command' and 'update' are allowed");
        }
		
		return self;
                
    }

    //This function is called when a react function is invoked
    //The last argument when invoking a function must always be a cb.
    _executeCommand(fncName, passedArgs){
        var self = this;
		
		//Convert args to an array
		var args = [];
		Object.keys(passedArgs).forEach(function(arg){
			args.push(passedArgs[arg]);
		});
		
		//If the command is not silent, prepare the response handling and timeouts
        if(!self._commands[fncName].silent){
			var cb = args.pop();
			
			if(!self._commands[fncName]) return cb("Command " + fncName + " does not exist");
		
			if(!self._conn.isOpen()) return cb("Serial port connection is closed, so command can not be sent");
        
			//This stuff is saved longterm, so when the response occurs we have a lot of information about it
			var executingFnc =
				{
					name: fncName,
					uuid: Math.random().toString(36).slice(-6), //uuid sent to mcu
					issuedOn: new Date(),
					timeout: null,
					callback: cb
				};
				
			//Set up the timeout for the react function
			if(self._commands[fncName].timeout > 0){
				if(self._commands[fncName].timeoutFnc){
					executingFnc.timeout = setTimeout(self._waitingResponse[fncName].timeoutFnc, self._commands[fncName].timeout);
				} else {
					executingFnc.timeout = setTimeout(function(){
						cb("Time out occured");
					}, self._commands[fncName].timeout);
				}
			}        
			
			//Save the info for reference
			self._waitingResponse[executingFnc.uuid] = executingFnc;
			
		} else{
			if(!self._commands[fncName]) throw new Error("Command " + fncName + " does not exist");
		
			if(!self._conn.isOpen()) throw new Error("Serial port connection is closed, so command can not be sent");
		}
        

        //Form up all the of the passed arguments into the proper format
        var output = "";
        output += self._commands[fncName].identifier;
		if(!self._commands[fncName].silent) output += "," + executingFnc.uuid;
        args.forEach( (arg)=> output += "," + arg );
        output += ";";
		
        //Finaly write out the stuff
        self._conn.write(output);
    }
    
    _handleCommandResponse(uuid, msg){
        var self = this;
        
        //Clear the timeout if there is one so it won't get called.
        if(self._waitingResponse[uuid].timeout) clearTimeout(self._waitingResponse[uuid].timeout);
        var incomingData = msg.split(",");
		incomingData.shift();
        var response = {};
        
        //Go through the returns for the function, and assign them the value if returned. This is done
        //by expecting the returns to be in the same order
        //CHANGE ME! Go by the length of returns and not length of the object?
        incomingData.forEach((value, index)=>{
            response[ self._commands[ self._waitingResponse[uuid].name ].returns[index] ] = value;
        });
        
        //Finally, call that react function cb!
        self._waitingResponse[uuid].callback(null, response, msg);
        
        //Delete the response waiting
        delete self._waitingResponse[uuid];
    }
	
	_handleUpdateMsg(identifier, msg){
		var self = this;
		
		//Check to make sure there is an update handler that can take the message
		if(!self._updateHandlers[identifier]) throw new Error("There is no such update handler by this identifier");
		
		//Translate incoming data and drop the first (it's the identifier still)
		var incomingData = msg.split(",");
		incomingData.shift();
		
		//Return via the returns
		var data = {};
		incomingData.forEach(function(value, index){
			//This scenario checks to see if more data came back than we have labels for
			if( self._updateHandlers[identifier].returns.length > index )
				data[ self._updateHandlers[identifier].returns[index] ] = value;
		});
		
		//Call the update handler function with the parsed data and raw message
		self._updateHandlers[identifier].then(data, msg);
	}
    
    _setListeners(){
        var self = this;
        
        if(!self._conn) throw new Error("Tried to set listeners when no connection object is set");
        
        self._conn.on("error", function(err){
            if(self._reconnectOnClose) self._repairConnection();
            if(self.onError) self.onError(err);
        });
        
        self._conn.on("close", function(){
            if(self._reconnectOnClose) self._repairConnection();
            if(self.onClose) self.onClose();
        });
        
        self._conn.on("data", function(msg){
			msg = msg.toString();
			
            var identifier = msg.split(",")[0];
			
            if(self._waitingResponse[identifier]) return self._handleCommandResponse(identifier, msg);
            else if(self._updateHandlers[identifier]) return self._handleUpdateMsg(identifier, msg);
			
			new Error("No such update handler found - " + identifier);
        });
    }
    
}

module.exports = Synapse;